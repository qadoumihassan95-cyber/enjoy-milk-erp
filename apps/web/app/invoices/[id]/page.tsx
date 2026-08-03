'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/app-shell';
import { api } from '@/lib/api';
import { InvoiceForm, fromApi } from '../_invoice-form';
import { Loader2 } from 'lucide-react';

export default function EditInvoicePage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => api.get(`/invoices/${id}`).then((r) => r.data),
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <AppShell>
        <div className="min-h-[40vh] flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
        </div>
      </AppShell>
    );
  }
  if (isError || !data) {
    return (
      <AppShell>
        <div className="max-w-md mx-auto mt-16 p-6 rounded-xl border border-red-200 bg-red-50 text-red-800 text-center">
          تعذر تحميل الفاتورة.
        </div>
      </AppShell>
    );
  }

  return <InvoiceForm mode="edit" initial={fromApi(data)} />;
}
