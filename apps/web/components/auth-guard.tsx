'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { api, isSessionEndedError } from '@/lib/api';
import { classifyError } from '@/lib/api-errors';
import { useAuthStore } from '@/stores/auth';
import { Loader2, WifiOff, RefreshCw } from 'lucide-react';

/**
 * AuthGuard — verifies the JWT with /auth/me on mount.
 *
 * PREVIOUS BEHAVIOR (buggy):
 *   Any /auth/me error → logout() + bailToLogin(). That meant a 500,
 *   Render cold start, DB blip, or plain network flake bounced the user
 *   to /login and blew away localStorage. Users hit the "انقطع الاتصال"
 *   screen constantly.
 *
 * NEW BEHAVIOR:
 *   - If /auth/me returns 401 → session-expired path takes over (via the
 *     interceptor + refresh) OR the interceptor's SessionEndedError fires
 *     and we no-op (it already redirected). No double-navigation.
 *   - If /auth/me fails transiently (5xx / network / timeout / offline)
 *     → keep retrying with exponential backoff, show a small reconnect
 *     banner. The user stays on the page. As soon as /auth/me succeeds,
 *     the banner disappears and the app resumes.
 *   - Only after ~5 consecutive retryable failures do we surface a
 *     manual "إعادة المحاولة" button — never a hard redirect to login.
 *   - 403 during /auth/me is treated as "unauthorized user" — bail to
 *     login (the account was disabled or role was revoked).
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, setUser, logout } = useAuthStore();
  const [checking, setChecking] = useState(true);
  const [transientState, setTransientState] = useState<null | {
    kind: 'network' | 'server' | 'timeout' | 'offline' | 'unknown';
    attempt: number;
  }>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    let stopped = false;

    const readToken = (): string | null => {
      try {
        if (typeof window === 'undefined') return null;
        return localStorage.getItem('accessToken');
      } catch { return null; }
    };

    const bailToLogin = () => {
      try { logout(); } catch { /* ignore */ }
      if (typeof window === 'undefined') {
        router.push('/login');
        return;
      }
      // Avoid loop when already on /login.
      if (window.location.pathname === '/login') return;
      const returnTo = pathname ? `?returnTo=${encodeURIComponent(pathname)}` : '';
      window.location.href = `/login${returnTo}`;
    };

    const attemptOnce = async (attempt: number): Promise<void> => {
      if (stopped || cancelledRef.current) return;

      const token = readToken();
      if (!token) { bailToLogin(); return; }

      try {
        const res = await api.get('/auth/me');
        if (stopped || cancelledRef.current) return;
        setUser(res.data);
        setTransientState(null);
        setChecking(false);
      } catch (e: any) {
        if (stopped || cancelledRef.current) return;

        // The interceptor already redirected — sit tight.
        if (isSessionEndedError(e)) return;

        const c = classifyError(e, { attempt });

        // 403 → account/role revoked. Send them to login cleanly.
        if (c.kind === 'permission') { bailToLogin(); return; }

        // 4xx (not 401 — the interceptor handled that) and not-found →
        // this shouldn't happen for /auth/me, but if it does, bail.
        if (c.kind === 'not-found') { bailToLogin(); return; }

        // Transient — keep retrying. Show the banner from attempt >= 1
        // so a single flake doesn't flash a banner.
        if (c.retriable) {
          if (attempt >= 1) {
            setTransientState({
              kind: c.kind as any,
              attempt,
            });
          }
          const delay = Math.max(c.retryAfterMs, 1_000);
          await new Promise((r) => setTimeout(r, delay));
          return attemptOnce(attempt + 1);
        }

        // Non-retriable, non-permission, non-not-found — bail defensively.
        bailToLogin();
      }
    };

    // Kick off with attempt 0.
    attemptOnce(0);

    // If we come back online mid-retry, jump the queue.
    const onOnline = () => {
      if (transientState) attemptOnce(0);
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onOnline);
    }

    return () => {
      stopped = true;
      cancelledRef.current = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onOnline);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // ── Reconnect banner ────────────────────────────────────────────────
  const banner = transientState && (
    <div
      role="status"
      className="fixed top-3 inset-x-3 z-[999] mx-auto max-w-md rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2 shadow-sm flex items-center gap-2"
      dir="rtl"
    >
      {transientState.kind === 'offline' ? (
        <WifiOff className="h-4 w-4" />
      ) : (
        <RefreshCw className="h-4 w-4 animate-spin" />
      )}
      <div className="text-xs font-bold flex-1">
        {transientState.kind === 'offline'
          ? 'لا يوجد اتصال بالإنترنت. سنستأنف عند عودة الاتصال.'
          : 'تعذر الوصول إلى الخادم. جارٍ إعادة المحاولة تلقائياً…'}
      </div>
      {transientState.attempt >= 4 && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="text-[11px] font-bold underline"
        >
          إعادة تحميل
        </button>
      )}
    </div>
  );

  // While the FIRST /auth/me is in flight and no user cached, show spinner.
  // Once we've retried at least once, the banner covers the messaging and
  // we can keep showing the spinner (children not yet mounted).
  if (checking || !user) {
    return (
      <>
        {banner}
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
        </div>
      </>
    );
  }

  return (
    <>
      {banner}
      {children}
    </>
  );
}
