/**
 * Regression tests for the error classification module.
 *
 * These lock in the contract every UI layer relies on:
 *
 *   Only kind === 'session-expired' may sign the user out.
 *   Everything else is treated as a transient failure — kept on the page,
 *   with a retry banner + auto-retry.
 *
 * If any of these tests break, the "انقطع الاتصال" bug is at risk of
 * re-emerging.
 */

import { classifyError } from './api-errors';

const nav = (online: boolean) => {
  (global as any).navigator = { onLine: online };
};

beforeEach(() => nav(true));

describe('classifyError — the whole point of this file', () => {
  it('403 → permission (NOT retriable, NOT session-expired)', () => {
    const err = { response: { status: 403 }, config: { url: '/inventory' } };
    const c = classifyError(err);
    expect(c.kind).toBe('permission');
    expect(c.retriable).toBe(false);
  });

  it('404 → not-found (NOT retriable, does NOT log user out)', () => {
    const err = { response: { status: 404 }, config: { url: '/orders/9999' } };
    const c = classifyError(err);
    expect(c.kind).toBe('not-found');
    expect(c.retriable).toBe(false);
  });

  it('429 → rate-limit, retriable, honours Retry-After (seconds)', () => {
    const err = {
      response: { status: 429, headers: { 'retry-after': '7' } },
      config: { url: '/reports/expensive' },
    };
    const c = classifyError(err);
    expect(c.kind).toBe('rate-limit');
    expect(c.retriable).toBe(true);
    expect(c.retryAfterMs).toBe(7_000);
  });

  it('500 → server, retriable, exponential backoff grows with attempt', () => {
    const err = { response: { status: 500 }, config: { url: '/inventory' } };
    const first = classifyError(err, { attempt: 0 });
    const third = classifyError(err, { attempt: 2 });
    expect(first.kind).toBe('server');
    expect(first.retriable).toBe(true);
    expect(third.retryAfterMs).toBeGreaterThan(first.retryAfterMs);
  });

  it('502/503/504 → server (Render cold start / gateway hiccup)', () => {
    for (const status of [502, 503, 504]) {
      const c = classifyError({ response: { status }, config: {} });
      expect(c.kind).toBe('server');
      expect(c.retriable).toBe(true);
    }
  });

  it('timeout (ECONNABORTED) → timeout, retriable, does NOT sign out', () => {
    const err = { code: 'ECONNABORTED', message: 'timeout of 25000ms exceeded' };
    const c = classifyError(err);
    expect(c.kind).toBe('timeout');
    expect(c.retriable).toBe(true);
  });

  it('network error (no response) → network, retriable', () => {
    const err = { code: 'ERR_NETWORK', message: 'Network Error' };
    const c = classifyError(err);
    expect(c.kind).toBe('network');
    expect(c.retriable).toBe(true);
  });

  it('navigator offline → offline (retriable, distinct message)', () => {
    nav(false);
    const err = { code: 'ERR_NETWORK', message: 'x' };
    const c = classifyError(err);
    expect(c.kind).toBe('offline');
    expect(c.retriable).toBe(true);
  });

  it('raw 401 is treated as SERVER-CLASS (retriable), NOT session-expired', () => {
    // The interceptor must first attempt refresh. A raw 401 that hasn't
    // been through the refresh path yet must NOT sign the user out.
    const err = { response: { status: 401 }, config: { url: '/inventory' } };
    const c = classifyError(err);
    expect(c.kind).toBe('server');
    expect(c.retriable).toBe(true);
  });

  it('401 with sessionRefreshFailed=true → session-expired (ONLY sign-out path)', () => {
    const err = { response: { status: 401 }, config: { url: '/inventory' } };
    const c = classifyError(err, { sessionRefreshFailed: true });
    expect(c.kind).toBe('session-expired');
    expect(c.retriable).toBe(false);
  });

  it('unknown error with no status and no code → unknown (retriable — safest default)', () => {
    const c = classifyError({});
    expect(c.kind).toBe('unknown');
    expect(c.retriable).toBe(true);
  });

  it('SAVE bug regression — a 401 during save is server-class, NOT auto-signout', () => {
    // The user's reported bug: click Save → forced to /login even when
    // the refresh token was still valid. The interceptor now only signs
    // the user out if the REFRESH ENDPOINT itself returned expired.
    // A first-time 401 on a save endpoint must be treated as server-class
    // so refresh can be attempted; sessionRefreshFailed only turns it into
    // 'session-expired' when refresh actually returned 401/403.
    const err = {
      response: { status: 401 },
      config: { url: '/inventory/items', method: 'post' },
    };
    const c = classifyError(err);
    expect(c.kind).toBe('server');       // interceptor will refresh
    expect(c.retriable).toBe(true);
    // Refresh had a hiccup — DO NOT sign out.
    const cAfterHiccup = classifyError(err, { sessionRefreshFailed: false });
    expect(cAfterHiccup.kind).toBe('server');
    // Refresh really rejected — sign out.
    const cAfterExpired = classifyError(err, { sessionRefreshFailed: true });
    expect(cAfterExpired.kind).toBe('session-expired');
  });

  it('every retriable kind has an Arabic message (for toasts)', () => {
    const kinds = ['server', 'network', 'timeout', 'offline', 'rate-limit', 'unknown'] as const;
    for (const kind of kinds) {
      const c = classifyError(
        kind === 'offline'
          ? (nav(false), { code: 'ERR_NETWORK' })
          : kind === 'server'
          ? { response: { status: 500 } }
          : kind === 'network'
          ? { code: 'ERR_NETWORK' }
          : kind === 'timeout'
          ? { code: 'ECONNABORTED' }
          : kind === 'rate-limit'
          ? { response: { status: 429, headers: {} } }
          : {},
      );
      expect(typeof c.message).toBe('string');
      expect(c.message.length).toBeGreaterThan(0);
      nav(true);
    }
  });
});
