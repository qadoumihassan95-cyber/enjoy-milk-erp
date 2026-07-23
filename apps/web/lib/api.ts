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
  // Avoid redirect loops — if already on /login, do nothing.
  try {
    if (window.location.pathname === '/login') return;
  } catch { /* ignore */ }
  // NAVIGATE FIRST, then clear storage. If we cleared first, React
  // components between the clear and the navigation might dereference
  // now-null auth state and throw during render — that was the exact
  // path that used to trigger the global-error 'حدث خطأ غير متوقع'
  // screen even for a routine session expiry.
  try {
    const returnTo = encodeURIComponent(
      window.location.pathname + window.location.search,
    );
    window.location.href = `/login?returnTo=${returnTo}`;
  } catch {
    try { window.location.href = '/login'; } catch { /* ignore */ }
  }
  // Clear on the next tick — by then the browser has committed the
  // navigation and no more renders will happen against stale state.
  setTimeout(() => {
    try {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
    } catch { /* ignore */ }
  }, 0);
}

// ── Single-flight refresh ──────────────────────────────────────────────
/**
 * Refresh result — DISCRIMINATED UNION so the interceptor can react
 * correctly to each failure mode. Prior version returned `string | null`
 * where null conflated three very different situations:
 *
 *   - Refresh token truly rejected (401)               → sign out
 *   - Refresh endpoint 5xx / timeout / network / cold-start → RETRY,
 *                                                            do NOT
 *                                                            sign out
 *   - No refresh token in storage                     → sign out
 *
 * The bug the user reported (save → suddenly logged out during normal
 * use) is this exact conflation: a Render cold-start on /auth/refresh
 * would return 500 → interceptor treated it as "session expired" →
 * cleared localStorage and hard-redirected to /login. Session was
 * actually fine. This union prevents that.
 */
type RefreshOutcome =
  | { kind: 'ok'; token: string }
  | { kind: 'expired' }       // real 401 from /auth/refresh (or no rt stored)
  | { kind: 'transient'; retryAfterMs: number };

let refreshPromise: Promise<RefreshOutcome> | null = null;

/**
 * Under a burst of concurrent 401s (e.g., dashboard fans out 5 queries in
 * parallel), we must NOT fire 5 refresh calls. The first request kicks off
 * the refresh; every subsequent 401 awaits the same promise. On success,
 * every original request is retried once with the new token. On transient
 * failure, every awaiter treats the outcome as transient (does NOT sign
 * out). Only a real 'expired' outcome signs out.
 */
async function refreshAccessToken(): Promise<RefreshOutcome> {
  if (typeof window === 'undefined') return { kind: 'expired' };
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async (): Promise<RefreshOutcome> => {
    try {
      const refreshToken = (() => {
        try { return localStorage.getItem('refreshToken'); } catch { return null; }
      })();
      if (!refreshToken) return { kind: 'expired' };

      // Bypass `api` (interceptor) so the refresh call itself can't loop.
      // Fresh axios instance with a comfortable timeout for Render cold starts.
      let res: any;
      try {
        res = await axios.post(
          `${API_URL}/api/auth/refresh`,
          { refreshToken },
          { timeout: 20_000, validateStatus: () => true },
        );
      } catch (netErr: any) {
        // Network error / abort — treat as transient. Do NOT sign out.
        return { kind: 'transient', retryAfterMs: 1_500 };
      }

      const status = res?.status ?? 0;

      // 5xx / 502 / 503 / 504 / 408 / 429 → transient. Do NOT sign out.
      if (status >= 500 || status === 408 || status === 429) {
        return { kind: 'transient', retryAfterMs: status === 429 ? 3_000 : 1_500 };
      }

      // 401 / 403 on refresh = the refresh token really is invalid.
      if (status === 401 || status === 403) {
        return { kind: 'expired' };
      }

      // 200 with a valid access token → success.
      const newAccess = res?.data?.accessToken;
      const newRefresh = res?.data?.refreshToken;
      if (status === 200 && newAccess) {
        try {
          localStorage.setItem('accessToken', newAccess);
          if (newRefresh) localStorage.setItem('refreshToken', newRefresh);
        } catch { /* ignore */ }
        sessionEndedFired = false; // allow another sign-out later if it happens
        return { kind: 'ok', token: newAccess };
      }

      // Anything else (unexpected status, missing body) → treat as transient
      // so we do NOT sign the user out defensively. Retry later.
      return { kind: 'transient', retryAfterMs: 2_000 };
    } catch {
      // Unexpected sync throw — again, transient.
      return { kind: 'transient', retryAfterMs: 2_000 };
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
      const outcome = await refreshAccessToken();

      if (outcome.kind === 'ok') {
        // Retry the original request with the new bearer token.
        originalRequest.headers = originalRequest.headers ?? {};
        (originalRequest.headers as any).Authorization = `Bearer ${outcome.token}`;
        return api(originalRequest);
      }

      if (outcome.kind === 'transient') {
        // Refresh endpoint had a hiccup (5xx / network / timeout / cold
        // start). The session is PROBABLY still valid — we just can't
        // tell right now. Reject with the ORIGINAL 401 carrying a
        // classified error so the caller can show a message and let
        // the user retry, but do NOT clear localStorage or redirect.
        // The next mutation attempt will try refresh again.
        const c = classifyError(error, { sessionRefreshFailed: false });
        // Overwrite kind so callers can treat it as a temporary server
        // problem, not a permanent one.
        (c as any).kind = 'server';
        (c as any).message = 'خطأ مؤقت أثناء تحديث الجلسة. الرجاء المحاولة مرة أخرى بعد لحظات.';
        logApiError(c, { method: originalRequest?.method });
        (error as any).classified = c;
        (error as any).transientRefresh = true;
        return Promise.reject(error);
      }

      // outcome.kind === 'expired' — the ONLY path that signs the user
      // out. Real 401/403 from /auth/refresh, or the refresh token was
      // never stored.
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
