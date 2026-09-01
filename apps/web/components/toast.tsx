'use client';

import { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastType = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastCtx {
  toast: (message: string, type?: ToastType) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Fallback آمن إن لم يُغلَّف المكوّن بالمزوّد (لا يكسر الصفحة)
    return {
      toast: (m) => console.log('[toast]', m),
      success: (m) => console.log('[toast:success]', m),
      error: (m) => console.warn('[toast:error]', m),
      info: (m) => console.log('[toast:info]', m),
    };
  }
  return ctx;
}

/**
 * Coerce anything into safe display text. Arrays join, objects fall back to
 * their own `.message` when present, everything else degrades to a generic
 * Arabic string rather than throwing inside React's render.
 */
function toDisplayText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return 'حدث خطأ';
  if (Array.isArray(v)) {
    const parts = v.map((x) => toDisplayText(x)).filter(Boolean);
    return parts.length ? parts.join('، ') : 'حدث خطأ';
  }
  if (typeof v === 'object') {
    const m = (v as Record<string, unknown>).message;
    if (typeof m === 'string' && m.trim()) return m;
    if (Array.isArray(m)) return toDisplayText(m);
    return 'حدث خطأ';
  }
  return String(v);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, type: ToastType = 'info') => {
      const id = Date.now() + Math.random();
      // Coerce defensively. `message` is TYPED as string, but it is fed from
      // `err?.response?.data?.message` all over the app, and an API that
      // returns an object or array there would otherwise reach React as a
      // child and throw "Objects are not valid as a React child" — escaping
      // the component and tripping the global error boundary. A toast must
      // never be able to take the page down.
      setToasts((t) => [...t, { id, type, message: toDisplayText(message) }]);
      setTimeout(() => remove(id), 4000);
    },
    [remove],
  );

  const api: ToastCtx = {
    toast,
    success: (m) => toast(m, 'success'),
    error: (m) => toast(m, 'error'),
    info: (m) => toast(m, 'info'),
  };

  const styles: Record<ToastType, string> = {
    success: 'bg-emerald-600 text-white',
    error: 'bg-red-600 text-white',
    info: 'bg-zinc-900 text-white',
  };
  const Icon: Record<ToastType, typeof CheckCircle2> = {
    success: CheckCircle2,
    error: AlertCircle,
    info: Info,
  };

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 w-[min(92vw,420px)] print:hidden">
        {toasts.map((t) => {
          const I = Icon[t.type];
          return (
            <div
              key={t.id}
              className={cn(
                'flex items-center gap-2.5 rounded-xl px-4 py-3 shadow-lg text-sm font-medium animate-in fade-in slide-in-from-bottom-2',
                styles[t.type],
              )}
              role="status"
            >
              <I className="h-5 w-5 shrink-0" />
              <span className="flex-1">{t.message}</span>
              <button onClick={() => remove(t.id)} className="opacity-70 hover:opacity-100">
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}
