'use client';

import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { ToastProvider } from '@/components/toast';
import { isSessionEndedError } from '@/lib/api';
import { classifyError } from '@/lib/api-errors';

/**
 * Global React Query defaults.
 *
 * Retry policy (matched to the classified errors from lib/api-errors):
 *   - SessionEndedError sentinel   → never retry, silently swallow (the
 *                                    interceptor already redirected).
 *   - 4xx (permission / not-found) → never retry.
 *   - 5xx / network / timeout / offline / rate-limit / unknown
 *                                  → retry up to 3 times with exponential
 *                                    backoff, capped at 30s.
 *
 * Mutations still default to no auto-retry (so we don't double-write) but
 * transient failures no longer sign the user out — the interceptor logs
 * them, callers can decide to re-issue manually with an idempotency key.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (err) => {
            if (isSessionEndedError(err)) return;
            const c = classifyError(err);
            // Session-expired shouldn't be shown (redirect handles it);
            // permission/not-found are page-level concerns (component
            // renders its own empty/permission-denied state).
            if (
              c.kind === 'session-expired' ||
              c.kind === 'permission' ||
              c.kind === 'not-found'
            ) return;
            // eslint-disable-next-line no-console
            console.warn('[query error]', c);
          },
        }),
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: true,
            retry: (count, err: any) => {
              if (isSessionEndedError(err)) return false;
              const c = classifyError(err, { attempt: count });
              if (!c.retriable) return false;
              return count < 3;
            },
            retryDelay: (attempt, err: any) => {
              const c = classifyError(err, { attempt });
              return Math.max(c.retryAfterMs, 1_000);
            },
          },
          mutations: {
            retry: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}
