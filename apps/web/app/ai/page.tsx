'use client';

/**
 * AI Assistant — the FE entry point for the AI layer.
 *
 * Talks ONLY to the ERP backend (never OpenRouter directly). Streams
 * responses over Server-Sent Events; falls back to a single JSON body
 * if the backend has streaming disabled.
 *
 * NO ERP data is connected yet (Phase 2). This is the foundation.
 */

import { useEffect, useRef, useState } from 'react';
import { Loader2, Send, Sparkles, AlertTriangle, WifiOff } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { api } from '@/lib/api';

type Role = 'user' | 'assistant';
interface UiMessage {
  role: Role;
  content: string;
  streaming?: boolean;
  error?: string;
  meta?: {
    provider?: string;
    model?: string;
    tier?: string;
    latencyMs?: number;
    tokens?: number;
    costUsd?: number;
  };
}

/** Same base-URL resolution as lib/api.ts (kept in sync with resolveApiUrl there). */
function apiBase(): string {
  const env = process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== 'undefined') {
    const onRender = window.location.hostname.endsWith('.onrender.com');
    if (onRender) {
      if (env && !env.includes('localhost')) return env;
      return `https://${window.location.hostname.replace('-web', '-api')}`;
    }
  }
  return env || 'http://localhost:3001';
}

export default function AiAssistantPage() {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [providerReady, setProviderReady] = useState<boolean | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Probe backend for provider readiness (no secrets returned).
  useEffect(() => {
    api.get('/ai/status').then((r) => {
      setProviderReady(!!r?.data?.configured);
    }).catch(() => setProviderReady(false));
  }, []);

  // Auto-scroll to bottom whenever messages change.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');

    const userMsg: UiMessage = { role: 'user', content: text };
    const asstMsg: UiMessage = { role: 'assistant', content: '', streaming: true };
    setMessages((m) => [...m, userMsg, asstMsg]);
    setSending(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const token = (typeof window !== 'undefined' && localStorage.getItem('accessToken')) || '';
      const res = await fetch(`${apiBase()}/api/ai/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify({ message: text, conversationId }),
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) {
        const errBody = await res.text().catch(() => '');
        let userMessage = 'تعذر إتمام الطلب.';
        try {
          const j = JSON.parse(errBody);
          userMessage = j?.message?.message ?? j?.message ?? userMessage;
        } catch { /* ignore */ }
        setMessages((m) => {
          const c = [...m];
          c[c.length - 1] = { ...c[c.length - 1], streaming: false, error: userMessage };
          return c;
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffered = '';
      let full = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });

        // Parse SSE frames: `event: NAME\ndata: {...}\n\n`
        let idx: number;
        while ((idx = buffered.indexOf('\n\n')) !== -1) {
          const frame = buffered.slice(0, idx);
          buffered = buffered.slice(idx + 2);
          const lines = frame.split('\n');
          let event = 'message';
          let data = '';
          for (const line of lines) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (!data) continue;
          let parsed: any;
          try { parsed = JSON.parse(data); } catch { continue; }

          if (event === 'delta' && parsed?.text) {
            full += parsed.text;
            setMessages((m) => {
              const c = [...m];
              c[c.length - 1] = { ...c[c.length - 1], content: full };
              return c;
            });
          } else if (event === 'done') {
            setConversationId(parsed.conversationId);
            setMessages((m) => {
              const c = [...m];
              c[c.length - 1] = {
                ...c[c.length - 1],
                streaming: false,
                content: parsed.content || full,
                meta: {
                  provider: parsed.provider,
                  model: parsed.model,
                  tier: parsed.tier,
                  latencyMs: parsed.latencyMs,
                  tokens: parsed?.usage?.totalTokens,
                  costUsd: parsed?.costUsd,
                },
              };
              return c;
            });
          } else if (event === 'error') {
            setMessages((m) => {
              const c = [...m];
              c[c.length - 1] = {
                ...c[c.length - 1],
                streaming: false,
                error: parsed?.message || 'خطأ من خدمة الذكاء الاصطناعي.',
              };
              return c;
            });
          }
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setMessages((m) => {
          const c = [...m];
          c[c.length - 1] = {
            ...c[c.length - 1],
            streaming: false,
            error: 'تعذر الاتصال بالخادم.',
          };
          return c;
        });
      }
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSending(false);
    setMessages((m) => {
      const c = [...m];
      if (c.length && c[c.length - 1].role === 'assistant') {
        c[c.length - 1] = { ...c[c.length - 1], streaming: false };
      }
      return c;
    });
  };

  const empty = messages.length === 0;

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto p-3 md:p-6 h-[calc(100dvh-64px)] flex flex-col" dir="rtl">
        {/* Header */}
        <header className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 text-white flex items-center justify-center">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-black tracking-tight">مساعد الذكاء الاصطناعي</h1>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                يوجّه الطلب تلقائياً للنموذج الأنسب
              </p>
            </div>
          </div>
          <StatusBadge ready={providerReady} />
        </header>

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-3 md:p-4 space-y-3"
        >
          {empty ? (
            <EmptyState />
          ) : (
            messages.map((m, i) => (
              <MessageBubble key={i} m={m} />
            ))
          )}
        </div>

        {/* Input */}
        <form
          onSubmit={(e) => { e.preventDefault(); send(); }}
          className="mt-3 flex items-end gap-2"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={providerReady === false
              ? 'خدمة الذكاء الاصطناعي غير مُهيّأة على الخادم — أضف OPENROUTER_API_KEY.'
              : 'اكتب سؤالك… (Enter للإرسال · Shift+Enter لسطر جديد)'}
            rows={1}
            disabled={providerReady === false}
            className="flex-1 resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 min-h-[44px] max-h-40 disabled:opacity-60"
            style={{ direction: 'rtl' }}
          />
          {sending ? (
            <button
              type="button"
              onClick={stop}
              className="h-11 px-4 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700 active:scale-[0.98]"
            >
              إيقاف
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim() || providerReady === false}
              className="h-11 px-4 rounded-xl bg-zinc-900 text-white text-sm font-bold hover:bg-zinc-800 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
            >
              <Send className="h-4 w-4" /> إرسال
            </button>
          )}
        </form>
      </div>
    </AppShell>
  );
}

function StatusBadge({ ready }: { ready: boolean | null }) {
  if (ready === null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> جارٍ الفحص…
      </span>
    );
  }
  if (ready) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-700">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> متاح
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-700">
      <WifiOff className="h-3.5 w-3.5" /> غير مُهيّأ
    </span>
  );
}

function EmptyState() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center py-12 gap-2">
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-50 to-purple-50 text-indigo-600 flex items-center justify-center">
        <Sparkles className="h-7 w-7" />
      </div>
      <div className="text-sm font-bold text-zinc-700">ابدأ محادثة</div>
      <div className="text-xs text-zinc-500 max-w-md">
        يستخدم النظام توجيهاً تلقائياً لاختيار النموذج الأنسب حسب طبيعة السؤال —
        الأسئلة القصيرة تذهب لنموذج اقتصادي، والتحليلات المعقّدة لنموذج متقدم.
      </div>
    </div>
  );
}

function MessageBubble({ m }: { m: UiMessage }) {
  const isUser = m.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-start' : 'justify-end'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
          isUser
            ? 'bg-zinc-900 text-white'
            : m.error
              ? 'bg-red-50 text-red-800 border border-red-200'
              : 'bg-zinc-100 text-zinc-900'
        }`}
      >
        {m.error ? (
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{m.error}</span>
          </div>
        ) : (
          <>
            {m.content}
            {m.streaming && (
              <span className="inline-block ms-1 animate-pulse">▍</span>
            )}
          </>
        )}
        {m.meta && !m.streaming && !m.error && (
          <div className="text-[10px] text-zinc-500 mt-1.5 flex items-center gap-2 flex-wrap">
            <span>{m.meta.provider}</span>
            <span>·</span>
            <span>{m.meta.model}</span>
            {m.meta.tier && <><span>·</span><span>{m.meta.tier}</span></>}
            {typeof m.meta.tokens === 'number' && <><span>·</span><span>{m.meta.tokens} tok</span></>}
            {typeof m.meta.latencyMs === 'number' && <><span>·</span><span>{m.meta.latencyMs}ms</span></>}
          </div>
        )}
      </div>
    </div>
  );
}
