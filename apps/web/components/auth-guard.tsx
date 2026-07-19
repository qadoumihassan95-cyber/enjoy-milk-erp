'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { Loader2 } from 'lucide-react';

/**
 * AuthGuard — verifies the JWT with /auth/me on mount.
 *
 * Hardened so we NEVER surface Next.js's default "Application error"
 * screen on session expiry:
 *   - localStorage access wrapped in try/catch (private browsing / disabled)
 *   - Any /auth/me error routes the user to /login with a returnTo path
 *   - If the api interceptor already fired the redirect (SessionEndedError),
 *     we no-op instead of double-navigating
 *   - Cancel flag prevents a stale probe from setting user AFTER unmount
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, setUser, logout } = useAuthStore();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;

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
      const returnTo = pathname ? `?returnTo=${encodeURIComponent(pathname)}` : '';
      // Hard-navigate on catastrophic failure so we don't compound errors
      // inside a router state that may already be broken.
      window.location.href = `/login${returnTo}`;
    };

    const check = async () => {
      const token = readToken();
      if (!token) { bailToLogin(); return; }
      try {
        const res = await api.get('/auth/me');
        if (cancelled) return;
        setUser(res.data);
        setChecking(false);
      } catch (e: any) {
        if (cancelled) return;
        // The api interceptor may have already redirected. If so, don't
        // compete with it — just stay in the loading state.
        if (e?.isSessionEnded) return;
        bailToLogin();
      }
    };

    check();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (checking || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  return <>{children}</>;
}
