import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { classifyError, logApiError } from './api-errors';

/**
 * API base URL resolution — unchanged.
 *
 * Priority:
 *   1) NEXT_PUBLIC_API_URL if set and not localhost
 *   2) On Render: derive api hostname from the web hostname
 *   3) Local: http://localhost:3001
 */
function resolveApiUrl(): string {
  const env = process.env.NEXT_PUBLIC_API_URL;
  const isBrowser = typeof window !== 'undefined';
  const onRender =
    isBrowser && window.location.hostname.endsWith('.onrender.com');

  if (onRender) {
    if (env && !env.includes('localhost')) return env;
    return `https://${window.location.hostname.replace('-web', '-api')}`;
  }
  return env || 'http://localhost:3001';
}

const API_URL = resolveApiUrl();

/**
 * A comfortably long timeout so Render cold-starts (30–45s) don't fire the
 * "connection lost" screen. If the request truly hangs longer, the retry
 * loop below kicks in.
 */
const API_TIMEOUT_MS = 25_000;

export const api = axios.create({
  baseURL: `${API_URL}/api`,
  withCredentials: false,
  timeout: API_TIMEOUT_MS,
});

// ── Bearer token injection ─────────────────────────────────────────────
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    try {
      const token = localStorage.getItem('accessToken');
      if (token) {
        config.headers = config.headers ?? {};
        (config.headers as any).Authorization = `Bearer ${token}`;
      }
    } catch { /* private mode / storage quota */ }
  }
  return config;
});

// ── Session-ended sentinel ─────────────────────────────────────────────
/**
 * Thrown ONLY when the refresh attempt has failed and there is no way to
 * recover the session. React Query is configured to silently swallow it.
 * Any other error keeps the user on the page.
 */
class SessionEndedError extends Error {
  isSessionEnded = true;
  constructor() {
    super('Session ended');
  }
}

let sessionEndedFired = false;
function endSessionAndRedirect() {
  if (sessionEndedFired) return;
  sessionEndedFired = true;
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
  } catch { /* ignore */ }
  try {
    const returnTo = encodeURIComponent(
      window.location.pathname + window.location.search,
    );
    // Avoid redirect loops — if already on /login, do nothing.
    if (window.location.pathname === '/login') return;
    window.location.href = `/login?returnTo=${returnTo}`;
  } catch {
    window.location.href = '/login';
  }
}

// ── Single-flight refresh ──────────────────────────────────────────────
/**
 * Under a burst of concurrent 401s (e.g., dashboard fans out 5 queries in
 * parallel), we must NOT fire 5 refresh calls. The first request kicks off
 * the refresh; every subsequent 401 awaits the same promise. On success,
 * every original request is retried once with the new token. On failure,
 * every awaiting request rejects with the same SessionEndedError.
 */
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const refreshToken = (() => {
        try { return localStorage.getItem('refreshToken'); } catch { return null; }
      })();
      if (!refreshToken) return null;

      // Bypass `api` (interceptor) so the refresh call itself can't loop.
      // Fresh axios instance with its own short timeout.
      const res = await axios.post(
        `${API_URL}/api/auth/refresh`,
        { refreshToken },
        { timeout: 15_000 },
      );
      const newAccess = res?.data?.accessToken;
      const newRefresh = res?.data?.refreshToken;
      if (!newAccess) return null;
      try {
        localStorage.setItem('accessToken', newAccess);
        if (newRefresh) localStorage.setItem('refreshToken', newRefresh);
      } catch { /* ignore */ }
      sessionEndedFired = false; // allow another logout later if it happens
      return newAccess;
    } catch {
      return null;
    } finally {
      // Clear after this tick so late awaiters see the resolved value
      // before we reset. (setTimeout 0 lets awaiters resolve first.)
      setTimeout(() => { refreshPromise = null; }, 0);
    }
  })();

  return refreshPromise;
}

// ── Retry helper for transient failures ────────────────────────────────
/**
 * Retry the original request once with a delay, unless it was flagged as
 * already-retried. This wraps 5xx / network / timeout / rate-limit —
 * NEVER 401 (that goes through the refresh path above).
 */
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// ── Response interceptor ───────────────────────────────────────────────
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = (error.config || {}) as AxiosRequestConfig & {
      _retry?: boolean;
      _attempt?: number;
    };

    const status = error.response?.status;
    const url = originalRequest?.url || '';
    const isAuthRefresh = url.includes('/auth/refresh');
    const isAuthLogin = url.includes('/auth/login');

    // Never mess with the login/refresh call itself.
    if (isAuthRefresh || isAuthLogin) {
      const c = classifyError(error);
      logApiError(c, { method: originalRequest?.method });
      return Promise.reject(error);
    }

    // ── 401 flow: single-flight refresh + retry once ─────────────────
    if (
      status === 401 &&
      !originalRequest._retry &&
      typeof window !== 'undefined'
    ) {
      originalRequest._retry = true;
      const newToken = await refreshAccessToken();
      if (newToken) {
        originalRequest.headers = originalRequest.headers ?? {};
        (originalRequest.headers as any).Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      }
      // Refresh failed — this is the only path that signs the user out.
      const c = classifyError(error, { sessionRefreshFailed: true });
      logApiError(c, { method: originalRequest?.method });
      endSessionAndRedirect();
      return Promise.reject(new SessionEndedError());
    }

    // ── Transient failure retry (5xx / network / timeout / 429) ──────
    const classified = classifyError(error, {
      attempt: originalRequest._attempt ?? 0,
    });
    logApiError(classified, {
      method: originalRequest?.method,
      attempt: originalRequest._attempt ?? 0,
    });

    if (
      classified.retriable &&
      (originalRequest._attempt ?? 0) < 1 // one auto-retry from the interceptor;
                                          // React Query does the rest.
    ) {
      originalRequest._attempt = (originalRequest._attempt ?? 0) + 1;
      await sleep(Math.min(classified.retryAfterMs, 5_000));
      return api(originalRequest);
    }

    // Bubble the ORIGINAL error out so React Query / callers can decide.
    // Attach the classification so components can render a proper message.
    (error as any).classified = classified;
    return Promise.reject(error);
  },
);

/** Exposed so QueryClient / components can detect an ended session. */
export function isSessionEndedError(e: unknown): boolean {
  return !!(e && (e as any).isSessionEnded === true);
}

/** True if this error is transient — components can decide to keep data visible. */
export function isTransientError(e: unknown): boolean {
  const kind = (e as any)?.classified?.kind;
  return (
    kind === 'server' ||
    kind === 'network' ||
    kind === 'timeout' ||
    kind === 'offline' ||
    kind === 'rate-limit' ||
    kind === 'unknown'
  );
}
