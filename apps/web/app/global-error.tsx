'use client';

/**
 * GLOBAL error boundary — LAST-RESORT ONLY.
 *
 * This screen ONLY fires when a React error escapes both `error.tsx` and
 * the whole Provider tree (i.e., a genuine JS exception during render,
 * NOT a network failure).
 *
 * The recurring "انقطع الاتصال" screen the user was hitting was actually
 * this component firing after AuthGuard `bailToLogin()` cascaded into a
 * component that then threw. AuthGuard no longer bails on transient
 * failures, so this screen should be rare in practice. When it DOES
 * fire, we no longer say "انقطع الاتصال" (that's misleading — a real
 * disconnect is now handled by the reconnect banner in AuthGuard).
 * We phrase it as a real "خطأ في التطبيق" so the user is not led to
 * believe they must re-authenticate.
 */

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[GlobalError]', error);
  }, [error]);

  const goHome = () => {
    window.location.href = '/dashboard';
  };

  const goLogin = () => {
    try {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
    } catch { /* no-op */ }
    window.location.href = '/login';
  };

  return (
    <html lang="ar" dir="rtl">
      <body
        style={{
          margin: 0,
          padding: 0,
          fontFamily: 'Cairo, system-ui, sans-serif',
          background: '#fafafa',
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            maxWidth: 440,
            width: 'calc(100% - 32px)',
            background: 'white',
            border: '1px solid #e4e4e7',
            borderRadius: 16,
            padding: 28,
            textAlign: 'center',
            boxShadow: '0 4px 24px rgba(0,0,0,0.05)',
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 8 }} aria-hidden="true">
            ⚠️
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 900, margin: '0 0 6px' }}>
            حدث خطأ غير متوقع
          </h1>
          <p style={{ fontSize: 14, color: '#71717a', margin: '0 0 20px', lineHeight: 1.7 }}>
            حدث خطأ في التطبيق. بياناتك محفوظة على الخادم.
            <br />
            حاول إعادة المحاولة، أو الرجوع للصفحة الرئيسية.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={reset}
              style={{
                fontFamily: 'inherit',
                padding: '12px 22px',
                borderRadius: 10,
                border: 'none',
                background: '#18181b',
                color: 'white',
                fontWeight: 700,
                fontSize: 14,
                cursor: 'pointer',
                minHeight: 44,
              }}
            >
              إعادة المحاولة
            </button>
            <button
              onClick={goHome}
              style={{
                fontFamily: 'inherit',
                padding: '12px 22px',
                borderRadius: 10,
                border: '1px solid #d4d4d8',
                background: 'white',
                color: '#18181b',
                fontWeight: 700,
                fontSize: 14,
                cursor: 'pointer',
                minHeight: 44,
              }}
            >
              الصفحة الرئيسية
            </button>
            <button
              onClick={goLogin}
              style={{
                fontFamily: 'inherit',
                padding: '12px 22px',
                borderRadius: 10,
                border: '1px solid #d4d4d8',
                background: 'white',
                color: '#71717a',
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer',
                minHeight: 44,
              }}
            >
              تسجيل الدخول من جديد
            </button>
          </div>
          {error?.digest && (
            <p style={{ fontSize: 11, color: '#a1a1aa', marginTop: 16 }}>
              رمز الخطأ: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
