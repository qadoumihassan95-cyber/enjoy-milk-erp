'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, ArrowRight, Plus, X, Filter } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Badge, Stat } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

const STATUS_LABEL: Record<string, { label: string; variant: 'default' | 'warning' | 'success' | 'danger' }> = {
  DRAFT:       { label: 'مسودة', variant: 'default' },
  IN_PROGRESS: { label: 'قيد التنفيذ', variant: 'warning' },
  COMPLETED:   { label: 'انتهى', variant: 'warning' },
  APPROVED:    { label: 'مُعتَمَد', variant: 'success' },
  CANCELLED:   { label: 'ملغي', variant: 'default' },
};

export default function CountsPage() {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');

  const { data: counts } = useQuery({
    queryKey: ['inv-counts', statusFilter],
    queryFn: () => api.get('/inventory/counts', { params: { status: statusFilter || undefined } }).then((r) => r.data),
  });

  const stats = useMemo(() => {
    const list = counts ?? [];
    return {
      total: list.length,
      open: list.filter((c: any) => ['DRAFT', 'IN_PROGRESS'].includes(c.status)).length,
      approved: list.filter((c: any) => c.status === 'APPROVED').length,
    };
  }, [counts]);

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
        <header>
          <button onClick={() => router.push('/inventory')} className="text-sm text-zinc-500 mb-2 flex items-center gap-1 hover:text-zinc-900">
            <ArrowRight className="h-4 w-4 rotate-180" /> العودة للمخزون
          </button>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-zinc-900 text-white flex items-center justify-center">
                <ClipboardList className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-black tracking-tight">الجرد</h1>
                <p className="text-sm text-zinc-500 mt-0.5">جلسات جرد + مقارنة تلقائية + اعتماد يطبّق الفروقات</p>
              </div>
            </div>
            <Button onClick={() => setShowNew(true)}>
              <Plus className="h-4 w-4" /> جرد جديد
            </Button>
          </div>
        </header>

        <section className="grid grid-cols-3 gap-3">
          <Stat label="إجمالي" value={stats.total} />
          <Stat label="مفتوح" value={stats.open} state={stats.open > 0 ? 'warning' : 'good'} />
          <Stat label="مُعتَمَد" value={stats.approved} state="good" />
        </section>

        {showNew && <NewCountForm onClose={() => setShowNew(false)} onSaved={(id) => { setShowNew(false); qc.invalidateQueries({ queryKey: ['inv-counts'] }); router.push(`/inventory/counts/${id}`); }} />}

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle>القائمة</CardTitle>
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-zinc-400" />
                {[
                  { v: '', l: 'الكل' },
                  { v: 'DRAFT', l: 'مسودة' },
                  { v: 'IN_PROGRESS', l: 'قيد التنفيذ' },
                  { v: 'APPROVED', l: 'مُعتَمَد' },
                ].map((s) => (
                  <button key={s.v} onClick={() => setStatusFilter(s.v)}
                    className={`px-2.5 py-1 rounded-md text-xs font-bold ${statusFilter === s.v ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600'}`}>{s.l}</button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {!counts || counts.length === 0 ? (
              <div className="p-12 text-center">
                <ClipboardList className="h-12 w-12 mx-auto text-zinc-300 mb-3" />
                <p className="text-zinc-500">لا توجد جلسات جرد</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 border-b">
                    <tr>
                      <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">رقم</th>
                      <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">التاريخ</th>
                      <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">مُجدوَل</th>
                      <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {counts.map((c: any) => {
                      const sb = STATUS_LABEL[c.status] || { label: c.status, variant: 'default' as const };
                      return (
                        <tr key={c.id} onClick={() => router.push(`/inventory/counts/${c.id}`)}
                            className="border-b border-zinc-100 hover:bg-zinc-50 cursor-pointer">
                          <td className="p-3 font-mono text-xs">{c.number}</td>
                          <td className="p-3 text-zinc-500">{formatDate(c.createdAt)}</td>
                          <td className="p-3 text-zinc-500">{c.scheduledAt ? formatDate(c.scheduledAt) : '—'}</td>
                          <td className="p-3"><Badge variant={sb.variant} dot>{sb.label}</Badge></td>
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

function NewCountForm({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ warehouseId: '', scheduledAt: '', frozen: false, notes: '' });

  const { data: whs } = useQuery({ queryKey: ['warehouses'], queryFn: () => api.get('/inventory/warehouses').then((r) => r.data) });

  const submit = useMutation({
    mutationFn: (body: any) => api.post('/inventory/counts', body).then((r) => r.data),
    onSuccess: (res) => { toast.success('تم إنشاء الجرد — ابدأ العدّ'); onSaved(res.id); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'تعذّر الإنشاء'),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>جرد جديد</CardTitle>
          <button onClick={onClose}><X className="h-4 w-4 text-zinc-400" /></button>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => { e.preventDefault(); submit.mutate({ ...form, warehouseId: form.warehouseId || undefined }); }} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-zinc-700">المستودع (اتركه فارغاً لجرد كل المستودعات)</label>
            <select value={form.warehouseId} onChange={(e) => setForm({ ...form, warehouseId: e.target.value })}
              className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm">
              <option value="">كل المستودعات</option>
              {(whs ?? []).map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <Input label="التاريخ المُجدول" type="date" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} />
          <label className="inline-flex items-center gap-2 text-xs text-zinc-700">
            <input type="checkbox" checked={form.frozen} onChange={(e) => setForm({ ...form, frozen: e.target.checked })} />
            تجميد الحركات أثناء الجرد (اختياري)
          </label>
          <Input label="ملاحظات" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-3 text-xs text-emerald-800">
            سيتم توليد سطر لكل مادة×مستودع بالكمية الموجودة حالياً في النظام كـ «الكمية المتوقعة».
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={onClose}>إلغاء</Button>
            <Button type="submit" loading={submit.isPending}>إنشاء الجرد</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
