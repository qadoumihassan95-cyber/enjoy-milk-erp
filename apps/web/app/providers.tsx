'use client';

import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { ToastProvider } from '@/components/toast';
import { isSessionEndedError } from '@/lib/api';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        // A QueryCache-level onError swallows the SessionEndedError sentinel
        // (thrown by the api interceptor when the JWT + refresh both fail)
        // so React Query never bubbles it up into components that would then
        // dereference undefined data and crash. The interceptor has already
        // triggered the hard redirect to /login by the time this fires.
        queryCache: new QueryCache({
          onError: (err) => {
            if (isSessionEndedError(err)) return;
            // eslint-disable-next-line no-console
            console.error('[query error]', err);
          },
        }),
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: true,
            retry: (count, err: any) => {
              if (isSessionEndedError(err)) return false;
              const status = err?.response?.status ?? err?.status;
              if (status >= 400 && status < 500) return false;
              return count < 2;
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
