/**
 * Central error classification for the whole frontend.
 *
 * Every network failure that reaches the app is passed through
 * `classifyError()` which returns a stable shape:
 *   { kind, retriable, retryAfterMs, message }
 *
 * The rule the whole system now follows:
 *   - Only `kind === 'session-expired'` may sign the user out.
 *   - Everything else keeps the user on the page. Transient failures
 *     (server, network, offline, rate-limit, timeout) are retried in
 *     the background and surfaced with a small dismissible toast —
 *     NEVER a full-page "انقطع الاتصال" redirect.
 *
 * This module is UI-agnostic. It only depends on axios types and the
 * browser's `navigator.onLine`. Toast wiring lives in providers.tsx.
 */

import type { AxiosError } from 'axios';

export type ErrorKind =
  | 'session-expired' // 401 with no valid refresh
  | 'permission'      // 403
  | 'not-found'       // 404
  | 'rate-limit'      // 429
  | 'server'          // 5xx
  | 'network'         // fetch/socket/dns failed
  | 'timeout'         // request exceeded API timeout
  | 'offline'         // navigator.onLine === false
  | 'unknown';        // fallback — treated as transient

export interface ClassifiedError {
  kind: ErrorKind;
  /** Safe to retry (server, network, offline, rate-limit, timeout, unknown). */
  retriable: boolean;
  /** Milliseconds to wait before the next retry attempt (used by React Query + interceptor). */
  retryAfterMs: number;
  /** Arabic user-facing message (for toasts). */
  message: string;
  /** HTTP status (present for HTTP errors only). */
  status?: number;
  /** Original endpoint (for logging). */
  url?: string;
  /** Whether this originated from the auth-related endpoint family. */
  isAuthEndpoint: boolean;
}

function isNetworkError(err: any): boolean {
  // axios sets no response for network / DNS / connection reset / abort.
  if (err?.response) return false;
  const code = String(err?.code || '').toUpperCase();
  return (
    code === 'ERR_NETWORK' ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ENOTFOUND' ||
    !!err?.message?.toLowerCase?.().includes('network')
  );
}

function isTimeoutError(err: any): boolean {
  if (err?.response) return false;
  const code = String(err?.code || '').toUpperCase();
  return (
    code === 'ECONNABORTED' ||
    code === 'ETIMEDOUT' ||
    !!err?.message?.toLowerCase?.().includes('timeout')
  );
}

function parseRetryAfter(header: string | null | undefined): number {
  if (!header) return 0;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs) * 1000;
  const asDate = Date.parse(header);
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  return 0;
}

/** Exponential backoff capped at 30s. */
function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempt), 30_000);
}

const MSGS: Record<ErrorKind, string> = {
  'session-expired': 'انتهت الجلسة. الرجاء تسجيل الدخول مجدداً.',
  permission: 'ليست لديك صلاحية للقيام بهذه العملية.',
  'not-found': 'المورد المطلوب غير موجود.',
  'rate-limit': 'الخادم مشغول. سنعيد المحاولة تلقائياً.',
  server: 'خطأ مؤقت في الخادم. جارٍ إعادة المحاولة…',
  network: 'تعذر الوصول إلى الخادم. جارٍ إعادة المحاولة…',
  timeout: 'انتهت مهلة الطلب. جارٍ إعادة المحاولة…',
  offline: 'لا يوجد اتصال بالإنترنت. سنستأنف عند عودة الاتصال.',
  unknown: 'حدث خطأ مؤقت. جارٍ إعادة المحاولة…',
};

/**
 * Classify any error thrown by axios (or synthesised inside our interceptor).
 * Pass `attempt` (0-indexed) to get an appropriate exponential backoff hint.
 *
 * Session-expired classification is HANDS-OFF here — the interceptor sets
 * that only after a refresh attempt has actually failed. A raw 401 is NOT
 * automatically "session-expired" from this module's perspective.
 */
export function classifyError(
  err: any,
  opts: { attempt?: number; sessionRefreshFailed?: boolean } = {},
): ClassifiedError {
  const attempt = opts.attempt ?? 0;
  const cfg: any = err?.config || {};
  const url: string | undefined = cfg?.url || err?.request?.responseURL;
  const isAuthEndpoint = typeof url === 'string' && url.includes('/auth/');

  const online =
    typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  if (!online) {
    return {
      kind: 'offline',
      retriable: true,
      retryAfterMs: 3_000,
      message: MSGS.offline,
      url,
      isAuthEndpoint,
    };
  }

  if (isTimeoutError(err)) {
    return {
      kind: 'timeout',
      retriable: true,
      retryAfterMs: backoffMs(attempt),
      message: MSGS.timeout,
      url,
      isAuthEndpoint,
    };
  }

  if (isNetworkError(err)) {
    return {
      kind: 'network',
      retriable: true,
      retryAfterMs: backoffMs(attempt),
      message: MSGS.network,
      url,
      isAuthEndpoint,
    };
  }

  const status: number | undefined = err?.response?.status;
  if (typeof status !== 'number') {
    return {
      kind: 'unknown',
      retriable: true,
      retryAfterMs: backoffMs(attempt),
      message: MSGS.unknown,
      url,
      isAuthEndpoint,
    };
  }

  if (status === 401) {
    if (opts.sessionRefreshFailed) {
      return {
        kind: 'session-expired',
        retriable: false,
        retryAfterMs: 0,
        message: MSGS['session-expired'],
        status,
        url,
        isAuthEndpoint,
      };
    }
    // First-time 401 is treated as SERVER-CLASS: the interceptor will try
    // to refresh, and only downgrade to 'session-expired' if refresh fails.
    return {
      kind: 'server',
      retriable: true,
      retryAfterMs: 0,
      message: MSGS.server,
      status,
      url,
      isAuthEndpoint,
    };
  }

  if (status === 403) {
    return {
      kind: 'permission',
      retriable: false,
      retryAfterMs: 0,
      message: MSGS.permission,
      status,
      url,
      isAuthEndpoint,
    };
  }

  if (status === 404) {
    return {
      kind: 'not-found',
      retriable: false,
      retryAfterMs: 0,
      message: MSGS['not-found'],
      status,
      url,
      isAuthEndpoint,
    };
  }

  if (status === 429) {
    const retryAfter = parseRetryAfter(
      err?.response?.headers?.['retry-after'] || err?.response?.headers?.['Retry-After'],
    );
    return {
      kind: 'rate-limit',
      retriable: true,
      retryAfterMs: retryAfter || backoffMs(attempt),
      message: MSGS['rate-limit'],
      status,
      url,
      isAuthEndpoint,
    };
  }

  if (status >= 500) {
    return {
      kind: 'server',
      retriable: true,
      retryAfterMs: backoffMs(attempt),
      message: MSGS.server,
      status,
      url,
      isAuthEndpoint,
    };
  }

  // 4xx we don't specifically handle — surface the original error, do NOT retry.
  return {
    kind: 'unknown',
    retriable: false,
    retryAfterMs: 0,
    message: err?.response?.data?.message || MSGS.unknown,
    status,
    url,
    isAuthEndpoint,
  };
}

/**
 * Structured (safe) log — endpoint / status / kind / userId / timestamp.
 * NEVER logs the request body, headers, token, password, or PII.
 */
export function logApiError(
  classified: ClassifiedError,
  extra: { userId?: string | null; method?: string; attempt?: number } = {},
) {
  const entry = {
    ts: new Date().toISOString(),
    kind: classified.kind,
    status: classified.status ?? null,
    endpoint: classified.url ?? null,
    method: extra.method ?? null,
    attempt: extra.attempt ?? 0,
    userId: extra.userId ?? null,
    online:
      typeof navigator === 'undefined' ? null : navigator.onLine !== false,
  };
  // Route through the global bus so a future log-sink (Sentry, backend
  // /events) can subscribe. For now: console.warn — visible in DevTools,
  // captured by browser log services.
  // eslint-disable-next-line no-console
  console.warn('[api-error]', entry);
  try {
    (window as any).__apiErrorBus?.emit?.(entry);
  } catch { /* no-op */ }
}
