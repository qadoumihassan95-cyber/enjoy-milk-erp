import axios, { AxiosError } from 'axios';

/**
 * يحدّد رابط الـ API بترتيب أولويات مضمون:
 *  1) NEXT_PUBLIC_API_URL إن ضُبط فعلاً (غير فارغ وغير localhost)
 *  2) على Render: يشتق رابط الـ api من اسم الـ web (enjoymilk-web → enjoymilk-api)
 *  3) محلياً: localhost:3001
 * هذا يتفادى مشكلة عدم تمرير build-arg على Render.
 */
function resolveApiUrl(): string {
  const env = process.env.NEXT_PUBLIC_API_URL;
  const isBrowser = typeof window !== 'undefined';
  const onRender =
    isBrowser && window.location.hostname.endsWith('.onrender.com');

  // إن كنّا على Render، تجاهل قيمة localhost المخبوزة خطأً واشتق الرابط الصحيح
  if (onRender) {
    if (env && !env.includes('localhost')) return env;
    return `https://${window.location.hostname.replace('-web', '-api')}`;
  }

  return env || 'http://localhost:3001';
}

const API_URL = resolveApiUrl();

export const api = axios.create({
  baseURL: `${API_URL}/api`,
  withCredentials: false,
});

// Attach token from localStorage
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('accessToken');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * Silent session-ended sentinel. When we can no longer recover the session
 * we throw THIS instead of the axios error — React Query treats it as a
 * "cancelled" query and downstream components never try to render
 * undefined data. Combined with the hard redirect that immediately
 * follows, the user simply lands on /login without the intermediate
 * white-screen "Application error" crash the customer was hitting.
 */
class SessionEndedError extends Error {
  isSessionEnded = true;
  constructor() {
    super('Session ended');
  }
}

let sessionEndedFired = false;
function endSessionAndRedirect() {
  if (sessionEndedFired) return; // avoid double-clear + double-redirect
  sessionEndedFired = true;
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
  } catch { /* private mode / storage quota */ }
  // Preserve the current URL so we can bounce back after login.
  try {
    const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?returnTo=${returnTo}`;
  } catch {
    window.location.href = '/login';
  }
}

// Handle 401 — try refresh, else silently end the session
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest: any = error.config;

    if (
      error.response?.status === 401 &&
      !originalRequest?._retry &&
      typeof window !== 'undefined' &&
      !originalRequest?.url?.includes('/auth/')
    ) {
      originalRequest._retry = true;
      const refreshToken = (() => {
        try { return localStorage.getItem('refreshToken'); } catch { return null; }
      })();
      if (refreshToken) {
        try {
          const res = await axios.post(`${API_URL}/api/auth/refresh`, { refreshToken });
          try {
            localStorage.setItem('accessToken', res.data.accessToken);
            localStorage.setItem('refreshToken', res.data.refreshToken);
          } catch { /* ignore storage errors */ }
          originalRequest.headers = originalRequest.headers ?? {};
          originalRequest.headers.Authorization = `Bearer ${res.data.accessToken}`;
          return api(originalRequest);
        } catch {
          endSessionAndRedirect();
          return Promise.reject(new SessionEndedError());
        }
      } else {
        endSessionAndRedirect();
        return Promise.reject(new SessionEndedError());
      }
    }
    return Promise.reject(error);
  },
);

/** Exposed so QueryClient / components can detect an ended session. */
export function isSessionEndedError(e: unknown): boolean {
  return !!(e && (e as any).isSessionEnded === true);
}
