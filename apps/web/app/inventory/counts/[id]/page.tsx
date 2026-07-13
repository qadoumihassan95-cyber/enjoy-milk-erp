'use client';

import { useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, ArrowRight, Check, XCircle, Search } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge, Stat } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/api';
import { formatNumber, formatDate, cn } from '@/lib/utils';

const STATUS_LABEL: Record<string, { label: string; variant: 'default' | 'warning' | 'success' | 'danger' }> = {
  DRAFT:       { label: 'مسودة', variant: 'default' },
  IN_PROGRESS: { label: 'قيد التنفيذ', variant: 'warning' },
  COMPLETED:   { label: 'انتهى', variant: 'warning' },
  APPROVED:    { label: 'مُعتَمَد', variant: 'success' },
  CANCELLED:   { label: 'ملغي', variant: 'default' },
};

export default function CountDetailPage() {
  const params = useParams();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const id = params.id as string;
  const [search, setSearch] = useState('');

  const { data: count } = useQuery({
    queryKey: ['inv-count', id],
    queryFn: () => api.get(`/inventory/counts/${id}`).then((r) => r.data),
    enabled: !!id,
  });

  const updateLine = useMutation({
    mutationFn: ({ lineId, actualQty, notes }: any) =>
      api.patch(`/inventory/counts/lines/${lineId}`, { actualQty, notes }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inv-count', id] }),
    onError: (e: any) => toast.error(e?.response?.data?.message || 'تعذّر التحديث'),
  });

  const close = useMutation({
    mutationFn: () => api.post(`/inventory/counts/${id}/close`).then((r) => r.data),
    onSuccess: (res) => {
      toast.success(`تم اعتماد الجرد + تطبيق ${res.adjustmentsApplied} فرق`);
      qc.invalidateQueries({ queryKey: ['inv-count', id] });
      qc.invalidateQueries({ queryKey: ['inv-dashboard'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'تعذّر الاعتماد'),
  });

  const cancel = useMutation({
    mutationFn: () => api.post(`/inventory/counts/${id}/cancel`).then((r) => r.data),
    onSuccess: () => {
      toast.success('تم الإلغاء');
      qc.invalidateQueries({ queryKey: ['inv-count', id] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'تعذّر الإلغاء'),
  });

  const filteredLines = useMemo(() => {
    if (!count?.lines) return [];
    const q = search.trim().toLowerCase();
    return count.lines.filter((l: any) => {
      if (!q) return true;
      return [l.item?.name, l.item?.sku, l.warehouse?.name].join(' ').toLowerCase().includes(q);
    });
  }, [count?.lines, search]);

  const summary = useMemo(() => {
    if (!count?.lines) return { total: 0, counted: 0, matched: 0, variance: 0, netDelta: 0 };
    let counted = 0, matched = 0, variance = 0, netDelta = 0;
    for (const l of count.lines) {
      if (l.actualQty != null) counted++;
      if (l.actualQty != null && Number(l.variance ?? 0) === 0) matched++;
      if (Number(l.variance ?? 0) !== 0) variance++;
      netDelta += Number(l.variance ?? 0);
    }
    return { total: count.lines.length, counted, matched, variance, netDelta };
  }, [count?.lines]);

  if (!count) return <AppShell><div className="p-8 text-center text-zinc-500">جاري التحميل...</div></AppShell>;

  const sb = STATUS_LABEL[count.status] || { label: count.status, variant: 'default' as const };
  const readOnly = ['APPROVED', 'CANCELLED'].includes(count.status);

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
        <header>
          <button onClick={() => router.push('/inventory/counts')} className="text-sm text-zinc-500 mb-2 flex items-center gap-1 hover:text-zinc-900">
            <ArrowRight className="h-4 w-4 rotate-180" /> العودة للجرد
          </button>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-zinc-900 text-white flex items-center justify-center">
                <ClipboardList className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-black tracking-tight flex items-center gap-2">
                  جرد {count.number} <Badge variant={sb.variant} dot>{sb.label}</Badge>
                </h1>
                <p className="text-sm text-zinc-500 mt-0.5">
                  {formatDate(count.createdAt)}
                  {count.notes ? ` · ${count.notes}` : ''}
                </p>
              </div>
            </div>
            {!readOnly && (
              <div className="flex gap-2">
                <Button variant="outline" className="text-red-600 border-red-200 hover:bg-red-50"
                  onClick={() => { if (confirm('إلغاء الجرد؟')) cancel.mutate(); }}>
                  <XCircle className="h-4 w-4" /> إلغاء
                </Button>
                <Button className="bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => { if (confirm(`اعتماد وتطبيق فروقات الجرد؟ (سيتم توليد ${summary.variance} تسوية على المخزون)`)) close.mutate(); }}
                  loading={close.isPending}
                >
                  <Check className="h-4 w-4" /> اعتماد وتطبيق الفروقات
                </Button>
              </div>
            )}
          </div>
        </header>

        <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Stat label="عدد البنود" value={summary.total} />
          <Stat label="مُجرَد" value={summary.counted} state={summary.counted === summary.total ? 'good' : 'warning'} />
          <Stat label="مطابق" value={summary.matched} state="good" />
          <Stat label="بفرق" value={summary.variance} state={summary.variance > 0 ? 'warning' : 'good'} />
          <Stat label="صافي الفرق" value={formatNumber(summary.netDelta, 2)} state={Math.abs(summary.netDelta) > 0 ? 'warning' : 'good'} />
        </section>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle>بنود الجرد</CardTitle>
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                <input value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="بحث بالمادة/المستودع..."
                  className="h-9 pr-9 pl-3 rounded-lg border border-zinc-200 text-sm w-64" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {filteredLines.length === 0 ? (
              <p className="text-sm text-zinc-500 text-center py-8">لا يوجد بنود</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 border-b">
                    <tr>
                      <th className="text-right p-2.5 text-[10px] font-bold text-zinc-500 uppercase">المادة</th>
                      <th className="text-right p-2.5 text-[10px] font-bold text-zinc-500 uppercase">المستودع</th>
                      <th className="text-right p-2.5 text-[10px] font-bold text-zinc-500 uppercase">المتوقع</th>
                      <th className="text-right p-2.5 text-[10px] font-bold text-zinc-500 uppercase">الفعلي</th>
                      <th className="text-right p-2.5 text-[10px] font-bold text-zinc-500 uppercase">الفرق</th>
                      <th className="text-right p-2.5 text-[10px] font-bold text-zinc-500 uppercase">ملاحظة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLines.map((l: any) => (
                      <CountLineRow key={l.id} line={l} readOnly={readOnly}
                        onSave={(actualQty, notes) => updateLine.mutate({ lineId: l.id, actualQty, notes })}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function CountLineRow({ line, readOnly, onSave }: { line: any; readOnly: boolean; onSave: (actualQty: number, notes: string) => void }) {
  const [actual, setActual] = useState(line.actualQty != null ? String(line.actualQty) : '');
  const [notes, setNotes] = useState(line.notes ?? '');
  const expected = Number(line.expectedQty);
  const actualN = actual === '' ? null : Number(actual);
  const variance = actualN != null ? actualN - expected : null;

  const commit = () => {
    if (readOnly) return;
    if (actual === '') return;
    const n = Number(actual);
    if (isNaN(n)) return;
    onSave(n, notes);
  };

  return (
    <tr className="border-b border-zinc-100">
      <td className="p-2.5">
        <div className="font-medium">{line.item?.name}</div>
        <div className="text-[11px] text-zinc-500 font-mono">{line.item?.sku}</div>
      </td>
      <td className="p-2.5 text-zinc-600">{line.warehouse?.name}</td>
      <td className="p-2.5 font-bold" data-numeric>{formatNumber(expected, 0)}</td>
      <td className="p-2.5">
        <input type="number" step="0.001" value={actual} onChange={(e) => setActual(e.target.value)} onBlur={commit}
          disabled={readOnly}
          className="w-24 h-8 px-2 rounded border border-zinc-200 text-sm"
        />
      </td>
      <td className={cn('p-2.5 font-bold', data_numeric_class(variance))} data-numeric>
        {variance == null ? '—' : (variance > 0 ? '+' : '') + formatNumber(variance, 2)}
      </td>
      <td className="p-2.5">
        <input value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={commit}
          disabled={readOnly}
          placeholder="ملاحظة..."
          className="w-full h-8 px-2 rounded border border-zinc-200 text-xs"
        />
      </td>
    </tr>
  );
}

function data_numeric_class(v: number | null): string {
  if (v == null) return 'text-zinc-400';
  if (v > 0) return 'text-emerald-700';
  if (v < 0) return 'text-red-600';
  return 'text-zinc-500';
}
