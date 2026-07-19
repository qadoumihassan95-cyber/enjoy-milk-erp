'use client';

/**
 * GLOBAL error boundary — catches errors that escape `error.tsx`.
 *
 * Next.js App Router: `error.tsx` only wraps a page's own render. Errors
 * thrown by the root `layout.tsx` or by any component ABOVE the page tree
 * (Providers, ToastProvider, AuthGuard, react-query, axios interceptors that
 * throw synchronously during render) escape to Next.js's built-in
 * "Application error: a client-side exception has occurred" fallback.
 *
 * By providing `global-error.tsx` at the app root, we override that
 * fallback with a friendly Arabic UI + a "Sign in again" escape hatch,
 * which was the customer's complaint: JWT expired mid-session → axios
 * interceptor's redirect races the component's null-dereference → screen
 * goes white with the default Next.js message.
 *
 * NOTE: global-error MUST include its own <html> and <body> because it
 * replaces the entire document tree when it fires.
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

  const goLogin = () => {
    try {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
    } catch { /* no-op */ }
    window.location.href = '/login';
  };

  const goHome = () => {
    window.location.href = '/dashboard';
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
            انقطع الاتصال
          </h1>
          <p style={{ fontSize: 14, color: '#71717a', margin: '0 0 20px', lineHeight: 1.7 }}>
            انتهت الجلسة أو حدث خطأ مؤقت. لا تقلق — بياناتك محفوظة.
            <br />
            سجّل الدخول مرة أخرى للمتابعة.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={goLogin}
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
              تسجيل الدخول من جديد
            </button>
            <button
              onClick={reset}
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
