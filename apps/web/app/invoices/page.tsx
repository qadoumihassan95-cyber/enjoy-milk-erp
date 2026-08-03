'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, FileText, Trash2, ChevronLeft } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, Button, Badge } from '@/components/ui';
import { api } from '@/lib/api';
import { useToast } from '@/components/toast';
import { formatDate } from '@/lib/utils';

export default function InvoicesListPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');

  const { data: invoices, isLoading, isError, refetch } = useQuery({
    queryKey: ['invoices', 'list'],
    queryFn: () => api.get('/invoices').then((r) => r.data),
  });

  const filtered = useMemo(() => {
    const list: any[] = Array.isArray(invoices) ? invoices : [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((r) =>
      (r.invoiceNumber || '').toLowerCase().includes(q) ||
      (r.customerName || '').toLowerCase().includes(q),
    );
  }, [invoices, search]);

  const handleDelete = async (id: string, number: string) => {
    if (!confirm(`تأكيد حذف/إلغاء الفاتورة "${number}"؟`)) return;
    try {
      await api.delete(`/invoices/${id}`);
      toast.success('تم الحذف');
      qc.invalidateQueries({ queryKey: ['invoices'] });
    } catch (e: any) {
      const msg = e?.response?.data?.message?.message || e?.response?.data?.message || 'تعذر الحذف';
      toast.error(String(msg));
    }
  };

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto p-3 md:p-6 space-y-4" dir="rtl">
        {/* DESKTOP */}
        <div className="hidden md:block space-y-4">
          <header className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push('/dashboard')}
                className="text-zinc-500 hover:text-zinc-900"
                title="رجوع"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <div className="w-10 h-10 rounded-xl bg-zinc-900 text-white flex items-center justify-center">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-black tracking-tight">الفواتير</h1>
                <p className="text-sm text-zinc-500 mt-0.5">إنشاء + طباعة + تصدير PDF</p>
              </div>
            </div>
            <Link href="/invoices/new">
              <Button>
                <Plus className="h-4 w-4" /> فاتورة جديدة
              </Button>
            </Link>
          </header>

          <Card className="p-3">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث برقم الفاتورة أو اسم الزبون…"
                className="w-full h-10 pr-10 pl-3 rounded-lg border border-zinc-200 text-sm"
              />
            </div>
          </Card>

          <Card>
            {isLoading ? (
              <div className="p-8 text-center text-zinc-400">جاري التحميل…</div>
            ) : isError ? (
              <div className="p-8 text-center">
                <div className="text-red-600 font-bold mb-1">تعذر تحميل الفواتير</div>
                <button onClick={() => refetch()} className="text-sm underline">إعادة المحاولة</button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-zinc-500">لا توجد فواتير{search && ' مطابقة للبحث'}</p>
                <Link href="/invoices/new" className="inline-block mt-3 text-sm text-blue-600 underline">
                  إنشاء أول فاتورة
                </Link>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs font-bold text-zinc-500 uppercase border-b border-zinc-200">
                      <th className="text-right p-3">رقم الفاتورة</th>
                      <th className="text-right p-3">التاريخ</th>
                      <th className="text-right p-3">الزبون</th>
                      <th className="text-right p-3">الإجمالي</th>
                      <th className="text-right p-3">الحالة</th>
                      <th className="text-right p-3">إجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r: any) => (
                      <tr key={r.id} className="border-b border-zinc-100 hover:bg-zinc-50 cursor-pointer">
                        <td className="p-3 font-black" onClick={() => router.push(`/invoices/${r.id}`)}>
                          {r.invoiceNumber}
                        </td>
                        <td className="p-3" onClick={() => router.push(`/invoices/${r.id}`)}>
                          {formatDate(r.invoiceDate)}
                        </td>
                        <td className="p-3" onClick={() => router.push(`/invoices/${r.id}`)}>
                          {r.customerName}
                        </td>
                        <td className="p-3 font-bold" onClick={() => router.push(`/invoices/${r.id}`)} dir="ltr">
                          {r.currency || '$'}
                          {Number(r.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="p-3" onClick={() => router.push(`/invoices/${r.id}`)}>
                          <StatusBadge status={r.status} />
                        </td>
                        <td className="p-3">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(r.id, r.invoiceNumber); }}
                            className="text-red-600 hover:text-red-800"
                            aria-label="حذف/إلغاء"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* MOBILE */}
        <div className="md:hidden space-y-3">
          <header className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-zinc-900 text-white flex items-center justify-center">
                <FileText className="h-4 w-4" />
              </div>
              <h1 className="text-lg font-black">الفواتير</h1>
            </div>
            <Link
              href="/invoices/new"
              aria-label="فاتورة جديدة"
              className="w-10 h-10 rounded-full bg-zinc-900 text-white flex items-center justify-center shadow-md active:scale-95"
            >
              <Plus className="h-4 w-4" />
            </Link>
          </header>

          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث…"
              className="w-full h-10 pr-10 pl-3 rounded-lg border border-zinc-200 text-sm"
            />
          </div>

          {isLoading ? (
            <div className="text-center text-zinc-400 py-8">جاري التحميل…</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-zinc-500">لا توجد فواتير</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((r: any) => (
                <Link
                  key={r.id}
                  href={`/invoices/${r.id}`}
                  className="block bg-white rounded-xl border border-zinc-200 p-3 active:bg-zinc-50"
                >
                  <div className="flex items-center justify-between">
                    <div className="font-black">{r.invoiceNumber}</div>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="text-sm text-zinc-700 mt-1">{r.customerName}</div>
                  <div className="flex items-center justify-between text-xs mt-2">
                    <span className="text-zinc-500">{formatDate(r.invoiceDate)}</span>
                    <span className="font-bold" dir="ltr">
                      {r.currency || '$'}
                      {Number(r.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label =
    status === 'ISSUED' ? 'مُصدرة' :
    status === 'CANCELLED' ? 'ملغاة' : 'مسودة';
  const variant =
    status === 'ISSUED' ? 'success' :
    status === 'CANCELLED' ? 'danger' : 'default';
  return <Badge variant={variant as any}>{label}</Badge>;
}
