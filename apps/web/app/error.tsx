'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // سجّل الخطأ في الـ console لتسهيل التشخيص (يظهر في DevTools)
    console.error('[App Error]', error);
  }, [error]);

  return (
    <div
      dir="rtl"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Cairo, system-ui, sans-serif',
        background: '#fafafa',
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 440,
          width: '100%',
          background: 'white',
          border: '1px solid #e4e4e7',
          borderRadius: 16,
          padding: 28,
          textAlign: 'center',
          boxShadow: '0 4px 24px rgba(0,0,0,0.05)',
        }}
      >
        <div style={{ fontSize: 40, marginBottom: 8 }}>⚠️</div>
        <h1 style={{ fontSize: 20, fontWeight: 900, margin: '0 0 6px' }}>
          حدث خطأ غير متوقع
        </h1>
        <p style={{ fontSize: 14, color: '#71717a', margin: '0 0 20px', lineHeight: 1.7 }}>
          لا تقلق — بياناتك محفوظة. يمكنك إعادة المحاولة أو العودة للصفحة الرئيسية.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => reset()}
            style={{
              fontFamily: 'inherit',
              padding: '10px 20px',
              borderRadius: 10,
              border: 'none',
              background: '#18181b',
              color: 'white',
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            إعادة المحاولة
          </button>
          <button
            onClick={() => (window.location.href = '/production')}
            style={{
              fontFamily: 'inherit',
              padding: '10px 20px',
              borderRadius: 10,
              border: '1px solid #d4d4d8',
              background: 'white',
              color: '#18181b',
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            قائمة الإنتاج
          </button>
        </div>
        {error?.digest && (
          <p style={{ fontSize: 11, color: '#a1a1aa', marginTop: 16 }}>
            رمز الخطأ: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
