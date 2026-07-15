'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, ArrowRight, Plus, Check, X, XCircle, Filter } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Badge, Stat } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/api';
import { formatNumber, formatDate } from '@/lib/utils';

const STATUS_LABEL: Record<string, { label: string; variant: 'default' | 'warning' | 'success' | 'danger' }> = {
  PENDING:   { label: 'بانتظار الاعتماد', variant: 'warning' },
  APPROVED:  { label: 'مُعتَمَد', variant: 'success' },
  COMPLETED: { label: 'مُنفَّذ', variant: 'success' },
  REJECTED:  { label: 'مرفوض', variant: 'danger' },
  CANCELLED: { label: 'ملغي', variant: 'default' },
};

export default function TransfersPage() {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');

  const { data: transfers } = useQuery({
    queryKey: ['inv-transfers', statusFilter],
    queryFn: () => api.get('/inventory/transfers', { params: { status: statusFilter || undefined } }).then((r) => r.data),
    refetchInterval: 30_000,
  });

  const action = useMutation({
    mutationFn: ({ id, op, reason }: any) =>
      api.post(`/inventory/transfers/${id}/${op}`, reason ? { reason } : {}).then((r) => r.data),
    onSuccess: (_res, vars: any) => {
      toast.success(
        vars.op === 'approve' ? 'تم اعتماد التحويل + خصم/إضافة الرصيد' :
        vars.op === 'reject'  ? 'تم رفض التحويل' : 'تم الإلغاء'
      );
      qc.invalidateQueries({ queryKey: ['inv-transfers'] });
      qc.invalidateQueries({ queryKey: ['inv-dashboard'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'تعذّرت العملية'),
  });

  const stats = useMemo(() => {
    const list = transfers ?? [];
    return {
      total: list.length,
      pending: list.filter((t: any) => t.status === 'PENDING').length,
      completed: list.filter((t: any) => t.status === 'COMPLETED').length,
      rejected: list.filter((t: any) => t.status === 'REJECTED').length,
    };
  }, [transfers]);

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto p-3 md:p-6 space-y-4 md:space-y-6 pb-24 md:pb-6">
        <header>
          <button onClick={() => router.push('/inventory')} className="text-sm text-zinc-500 mb-2 flex items-center gap-1 hover:text-zinc-900">
            <ArrowRight className="h-4 w-4 rotate-180" /> العودة للمخزون
          </button>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-zinc-900 text-white flex items-center justify-center">
                <ArrowLeftRight className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-black tracking-tight">تحويلات المستودعات</h1>
                <p className="text-sm text-zinc-500 mt-0.5">طلب تحويل → موافقة المدير → تنفيذ تلقائي</p>
              </div>
            </div>
            <Button onClick={() => setShowNew(true)}>
              <Plus className="h-4 w-4" /> طلب تحويل جديد
            </Button>
          </div>
        </header>

        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="إجمالي التحويلات" value={stats.total} />
          <Stat label="بانتظار الموافقة" value={stats.pending} state={stats.pending > 0 ? 'warning' : 'good'} />
          <Stat label="مُنفَّذ" value={stats.completed} state="good" />
          <Stat label="مرفوض" value={stats.rejected} state={stats.rejected > 0 ? 'danger' : 'good'} />
        </section>

        {showNew && <NewTransferForm onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); qc.invalidateQueries({ queryKey: ['inv-transfers'] }); }} />}

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle>القائمة</CardTitle>
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-zinc-400" />
                {[
                  { v: '', l: 'الكل' },
                  { v: 'PENDING', l: 'بانتظار' },
                  { v: 'COMPLETED', l: 'مُنفَّذ' },
                  { v: 'REJECTED', l: 'مرفوض' },
                  { v: 'CANCELLED', l: 'ملغي' },
                ].map((s) => (
                  <button key={s.v} onClick={() => setStatusFilter(s.v)}
                    className={`px-2.5 py-1 rounded-md text-xs font-bold ${statusFilter === s.v ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600'}`}
                  >
                    {s.l}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {!transfers || transfers.length === 0 ? (
              <div className="p-12 text-center">
                <ArrowLeftRight className="h-12 w-12 mx-auto text-zinc-300 mb-3" />
                <p className="text-zinc-500">لا توجد تحويلات</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 border-b">
                    <tr>
                      <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">رقم</th>
                      <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">التاريخ</th>
                      <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">الكمية</th>
                      <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">الحالة</th>
                      <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">إجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transfers.map((t: any) => {
                      const sb = STATUS_LABEL[t.status] || { label: t.status, variant: 'default' as const };
                      return (
                        <tr key={t.id} className="border-b border-zinc-100 hover:bg-zinc-50">
                          <td className="p-3 font-mono text-xs">{t.number}</td>
                          <td className="p-3 text-zinc-500">{formatDate(t.createdAt)}</td>
                          <td className="p-3 font-bold" data-numeric>{formatNumber(t.quantity, 0)}</td>
                          <td className="p-3"><Badge variant={sb.variant} dot>{sb.label}</Badge></td>
                          <td className="p-3">
                            {t.status === 'PENDING' && (
                              <div className="flex gap-1.5">
                                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700"
                                  onClick={() => { if (confirm(`اعتماد التحويل ${t.number}؟ سيتم خصم/إضافة الرصيد فوراً.`)) action.mutate({ id: t.id, op: 'approve' }); }}
                                >
                                  <Check className="h-3 w-3" /> اعتماد
                                </Button>
                                <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50"
                                  onClick={() => { const reason = prompt('سبب الرفض:'); if (reason !== null) action.mutate({ id: t.id, op: 'reject', reason }); }}
                                >
                                  <X className="h-3 w-3" /> رفض
                                </Button>
                                <Button size="sm" variant="ghost"
                                  onClick={() => { if (confirm('إلغاء التحويل؟')) action.mutate({ id: t.id, op: 'cancel' }); }}
                                >
                                  <XCircle className="h-3 w-3" />
                                </Button>
                              </div>
                            )}
                            {t.rejectedReason && <div className="text-[11px] text-red-500 mt-1">سبب: {t.rejectedReason}</div>}
                          </td>
                        </tr>
                      );
                    })}
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

function NewTransferForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ itemId: '', fromWarehouseId: '', toWarehouseId: '', quantity: '', notes: '' });

  const { data: items } = useQuery({ queryKey: ['items-active'], queryFn: () => api.get('/inventory/items').then((r) => r.data) });
  const { data: whs } = useQuery({ queryKey: ['warehouses'], queryFn: () => api.get('/inventory/warehouses').then((r) => r.data) });

  const submit = useMutation({
    mutationFn: (body: any) => api.post('/inventory/transfers', body).then((r) => r.data),
    onSuccess: () => { toast.success('تم إنشاء طلب التحويل'); onSaved(); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'تعذّر الإنشاء'),
  });

  const handle = (e: React.FormEvent) => {
    e.preventDefault();
    const qty = parseFloat(form.quantity);
    if (isNaN(qty) || qty <= 0) return toast.error('الكمية غير صحيحة');
    if (form.fromWarehouseId === form.toWarehouseId) return toast.error('لا يمكن نفس المستودع');
    submit.mutate({ ...form, quantity: qty });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>طلب تحويل جديد</CardTitle>
          <button onClick={onClose}><X className="h-4 w-4 text-zinc-400" /></button>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handle} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-zinc-700">المادة *</label>
            <select value={form.itemId} onChange={(e) => setForm({ ...form, itemId: e.target.value })} required
              className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm">
              <option value="">— اختر —</option>
              {(items ?? []).map((it: any) => <option key={it.id} value={it.id}>{it.name} ({it.sku})</option>)}
            </select>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-700">من مستودع *</label>
              <select value={form.fromWarehouseId} onChange={(e) => setForm({ ...form, fromWarehouseId: e.target.value })} required
                className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm">
                <option value="">— اختر —</option>
                {(whs ?? []).map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-700">إلى مستودع *</label>
              <select value={form.toWarehouseId} onChange={(e) => setForm({ ...form, toWarehouseId: e.target.value })} required
                className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm">
                <option value="">— اختر —</option>
                {(whs ?? []).map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
          </div>
          <Input label="الكمية *" type="number" step="0.001" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required />
          <Input label="ملاحظات" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <div className="rounded-lg bg-amber-50 border border-amber-100 p-3 text-xs text-amber-800">
            ⚠ سيبقى الطلب في حالة «بانتظار» حتى يعتمده المدير. عند الاعتماد يُخصم من المُرسِل ويُضاف للمستقبل فوراً.
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={onClose}>إلغاء</Button>
            <Button type="submit" loading={submit.isPending}>حفظ الطلب</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
