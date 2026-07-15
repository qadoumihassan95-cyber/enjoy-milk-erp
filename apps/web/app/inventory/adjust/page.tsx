'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Wrench, ArrowRight } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, CardHeader, CardTitle, CardContent, Button, Input } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/api';

const ADJUST_TYPES = [
  { value: 'ADD', label: 'إضافة كمية', color: 'emerald' },
  { value: 'DEDUCT', label: 'خصم كمية', color: 'amber' },
  { value: 'CORRECTION', label: 'تصحيح كمية (دلتا)', color: 'zinc' },
  { value: 'COUNT', label: 'جرد (قيمة مطلقة)', color: 'blue' },
  { value: 'DAMAGE', label: 'إتلاف', color: 'red' },
  { value: 'LOSS', label: 'فقدان', color: 'red' },
  { value: 'EXPIRY', label: 'انتهاء صلاحية', color: 'red' },
  { value: 'SUPPLIER_RETURN', label: 'إرجاع للمورد', color: 'zinc' },
];

export default function AdjustStockPage() {
  const router = useRouter();
  const toast = useToast();
  // ─── مخزن واحد فقط (المخزن الرئيسي). لا حاجة لاختيار مستودع في الواجهة.
  const [form, setForm] = useState({
    itemId: '',
    type: 'ADD',
    quantity: '',
    reason: '',
    notes: '',
    imageUrl: '',
  });

  const { data: items } = useQuery({
    queryKey: ['items-active'],
    queryFn: () => api.get('/inventory/items').then((r) => r.data),
  });

  const submit = useMutation({
    mutationFn: (body: any) => api.post('/inventory/adjust', body).then((r) => r.data),
    onSuccess: (res) => {
      toast.success(`تم التعديل — الرصيد الحالي: ${res.after}`);
      setForm({ itemId: '', type: 'ADD', quantity: '', reason: '', notes: '', imageUrl: '' });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'تعذّر التعديل'),
  });

  const handle = (e: React.FormEvent) => {
    e.preventDefault();
    const qty = parseFloat(form.quantity);
    if (isNaN(qty)) return toast.error('كمية غير صحيحة');
    if (form.type !== 'COUNT' && qty <= 0) return toast.error('الكمية يجب أن تكون أكبر من صفر');
    if (!form.reason.trim()) return toast.error('السبب مطلوب');
    submit.mutate({ ...form, quantity: qty });
  };

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto p-3 md:p-6 space-y-4 md:space-y-6 pb-24 md:pb-6">
        <header>
          <button onClick={() => router.push('/inventory')} className="text-sm text-zinc-500 mb-2 flex items-center gap-1 hover:text-zinc-900">
            <ArrowRight className="h-4 w-4 rotate-180" /> العودة للمخزون
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-zinc-900 text-white flex items-center justify-center">
              <Wrench className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-black tracking-tight">تعديل مخزون</h1>
              <p className="text-sm text-zinc-500 mt-0.5">إضافة/خصم/تصحيح/جرد/إتلاف/فقدان/انتهاء صلاحية/إرجاع للمورد</p>
            </div>
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>عملية جديدة</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handle} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-700">المادة *</label>
                <select
                  value={form.itemId}
                  onChange={(e) => setForm({ ...form, itemId: e.target.value })}
                  className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
                  required
                >
                  <option value="">— اختر —</option>
                  {(items ?? []).map((it: any) => (
                    <option key={it.id} value={it.id}>{it.name} ({it.sku})</option>
                  ))}
                </select>
              </div>
              <div className="rounded-lg bg-blue-50 border border-blue-100 p-2 text-[11px] text-blue-800">
                📦 كل التعديلات تُطبَّق على «المخزن الرئيسي / Main Warehouse» — المصنع يعمل بمخزن واحد فقط.
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-700">نوع العملية *</label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {ADJUST_TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setForm({ ...form, type: t.value })}
                      className={`p-2 rounded-lg border text-sm font-bold transition-colors ${
                        form.type === t.value
                          ? 'bg-zinc-900 text-white border-zinc-900'
                          : 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <Input
                  label={form.type === 'COUNT' ? 'الكمية الفعلية (المطلقة) *' : form.type === 'CORRECTION' ? 'قيمة الدلتا (+/-) *' : 'الكمية *'}
                  type="number"
                  step="0.001"
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                  required
                />
                <Input
                  label="السبب *"
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  placeholder="مثال: انتهاء صلاحية، فقدان، إعادة جرد..."
                  required
                />
              </div>

              <Input
                label="ملاحظات (اختياري)"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
              <Input
                label="رابط مرفق (صورة/ملف — اختياري)"
                value={form.imageUrl}
                onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
                placeholder="https://..."
              />

              <div className="rounded-lg bg-amber-50 border border-amber-100 p-3 text-xs text-amber-800">
                ⚠ كل عملية تُسجَّل في سجل التدقيق مع اسم الموظف والوقت والكميات قبل وبعد التعديل.
              </div>

              <div className="flex justify-end gap-3">
                <Button type="button" variant="ghost" onClick={() => router.push('/inventory')}>إلغاء</Button>
                <Button type="submit" loading={submit.isPending}>حفظ التعديل</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
