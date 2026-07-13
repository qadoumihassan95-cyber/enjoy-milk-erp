'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Truck, ArrowRight, Plus } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, CardHeader, CardTitle, CardContent, Button, Input } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/api';

const SOURCES = [
  { value: 'SUPPLIER', label: 'استلام من مورد', showSupplier: true },
  { value: 'MANUAL', label: 'إضافة يدوية', showSupplier: false },
  { value: 'TRANSFER_IN', label: 'تحويل من فرع/مستودع آخر', showSupplier: false },
  { value: 'CUSTOMER_RETURN', label: 'مرتجع عميل', showSupplier: false },
  { value: 'PRODUCTION', label: 'إنتاج جديد', showSupplier: false },
];

export default function ReceiveStockPage() {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();

  const [form, setForm] = useState({
    itemId: '',
    warehouseId: '',
    source: 'SUPPLIER',
    quantity: '',
    unitCost: '',
    supplierId: '',
    invoiceNumber: '',
    purchaseOrderNumber: '',
    batchNumber: '',
    serialNumber: '',
    productionDate: '',
    expiryDate: '',
    notes: '',
  });
  const [newSupplier, setNewSupplier] = useState({ show: false, name: '', phone: '', code: '' });

  const { data: items } = useQuery({
    queryKey: ['items-active'],
    queryFn: () => api.get('/inventory/items').then((r) => r.data),
  });

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.get('/inventory/warehouses').then((r) => r.data),
  });

  const { data: suppliers } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.get('/inventory/suppliers').then((r) => r.data),
  });

  const addSupplier = useMutation({
    mutationFn: (body: any) => api.post('/inventory/suppliers', body).then((r) => r.data),
    onSuccess: (res) => {
      toast.success('تم إضافة المورد');
      setForm({ ...form, supplierId: res.id });
      setNewSupplier({ show: false, name: '', phone: '', code: '' });
      qc.invalidateQueries({ queryKey: ['suppliers'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'تعذّر إضافة المورد'),
  });

  const submit = useMutation({
    mutationFn: (body: any) => api.post('/inventory/receive', body).then((r) => r.data),
    onSuccess: () => {
      toast.success('تم استلام المخزون بنجاح');
      setForm({
        itemId: '', warehouseId: '', source: 'SUPPLIER', quantity: '', unitCost: '',
        supplierId: '', invoiceNumber: '', purchaseOrderNumber: '', batchNumber: '',
        serialNumber: '', productionDate: '', expiryDate: '', notes: '',
      });
      qc.invalidateQueries({ queryKey: ['inv-dashboard'] });
      qc.invalidateQueries({ queryKey: ['inv-items'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'تعذّر الاستلام'),
  });

  const handle = (e: React.FormEvent) => {
    e.preventDefault();
    const qty = parseFloat(form.quantity);
    if (isNaN(qty) || qty <= 0) return toast.error('كمية غير صحيحة');
    if (!form.itemId) return toast.error('اختر المادة');
    if (!form.warehouseId) return toast.error('اختر المستودع');
    submit.mutate({
      ...form,
      quantity: qty,
      unitCost: form.unitCost ? +form.unitCost : undefined,
      supplierId: form.supplierId || undefined,
      productionDate: form.productionDate || undefined,
      expiryDate: form.expiryDate || undefined,
    });
  };

  const currentSource = SOURCES.find((s) => s.value === form.source);

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
        <header>
          <button onClick={() => router.push('/inventory')} className="text-sm text-zinc-500 mb-2 flex items-center gap-1 hover:text-zinc-900">
            <ArrowRight className="h-4 w-4 rotate-180" /> العودة للمخزون
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center">
              <Truck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-black tracking-tight">إضافة مخزون</h1>
              <p className="text-sm text-zinc-500 mt-0.5">استلام بضاعة من مصادر مختلفة</p>
            </div>
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>عملية استلام</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handle} className="space-y-4">
              {/* Source selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-700">المصدر *</label>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  {SOURCES.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => setForm({ ...form, source: s.value })}
                      className={`p-2 rounded-lg border text-xs font-bold transition-colors ${
                        form.source === s.value
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-zinc-700">المادة *</label>
                  <select
                    value={form.itemId} onChange={(e) => setForm({ ...form, itemId: e.target.value })}
                    className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm" required
                  >
                    <option value="">— اختر —</option>
                    {(items ?? []).map((it: any) => (
                      <option key={it.id} value={it.id}>{it.name} ({it.sku})</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-zinc-700">المستودع *</label>
                  <select
                    value={form.warehouseId} onChange={(e) => setForm({ ...form, warehouseId: e.target.value })}
                    className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm" required
                  >
                    <option value="">— اختر —</option>
                    {(warehouses ?? []).map((w: any) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
                <Input
                  label="الكمية *" type="number" step="0.001"
                  value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required
                />
                <Input
                  label="سعر الوحدة"
                  type="number" step="0.01"
                  value={form.unitCost} onChange={(e) => setForm({ ...form, unitCost: e.target.value })}
                  hint={currentSource?.showSupplier ? 'يُستخدم لتحديث متوسط تكلفة الصنف' : undefined}
                />
              </div>

              {/* Supplier section — only when SUPPLIER */}
              {currentSource?.showSupplier && (
                <div className="rounded-xl bg-zinc-50 border border-zinc-100 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-bold text-zinc-700">بيانات المورد</div>
                    <button type="button" onClick={() => setNewSupplier({ ...newSupplier, show: !newSupplier.show })}
                      className="text-xs text-blue-600 underline"
                    >
                      {newSupplier.show ? 'إلغاء' : '+ مورد جديد'}
                    </button>
                  </div>
                  {!newSupplier.show ? (
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-zinc-700">المورد</label>
                      <select
                        value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
                        className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
                      >
                        <option value="">— اختر —</option>
                        {(suppliers ?? []).map((s: any) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="grid md:grid-cols-3 gap-2">
                      <Input label="الاسم *" value={newSupplier.name} onChange={(e) => setNewSupplier({ ...newSupplier, name: e.target.value })} />
                      <Input label="الهاتف" value={newSupplier.phone} onChange={(e) => setNewSupplier({ ...newSupplier, phone: e.target.value })} />
                      <div className="flex items-end">
                        <Button type="button" className="w-full" loading={addSupplier.isPending}
                          onClick={() => newSupplier.name.trim() ? addSupplier.mutate({ name: newSupplier.name, phone: newSupplier.phone || undefined }) : toast.error('اسم المورد مطلوب')}
                        >
                          <Plus className="h-4 w-4" /> حفظ المورد
                        </Button>
                      </div>
                    </div>
                  )}
                  <div className="grid md:grid-cols-2 gap-3">
                    <Input label="رقم الفاتورة" value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} />
                    <Input label="رقم أمر الشراء" value={form.purchaseOrderNumber} onChange={(e) => setForm({ ...form, purchaseOrderNumber: e.target.value })} />
                  </div>
                </div>
              )}

              {/* Batch & serial */}
              <div className="rounded-xl bg-zinc-50 border border-zinc-100 p-4 space-y-3">
                <div className="text-xs font-bold text-zinc-700">التشغيلة والتواريخ (اختياري)</div>
                <div className="grid md:grid-cols-2 gap-3">
                  <Input label="رقم التشغيلة (Batch)" value={form.batchNumber} onChange={(e) => setForm({ ...form, batchNumber: e.target.value })} />
                  <Input label="الرقم التسلسلي" value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} />
                  <Input label="تاريخ الإنتاج" type="date" value={form.productionDate} onChange={(e) => setForm({ ...form, productionDate: e.target.value })} />
                  <Input label="تاريخ الانتهاء" type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
                </div>
              </div>

              <Input label="ملاحظات" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />

              <div className="flex justify-end gap-3">
                <Button type="button" variant="ghost" onClick={() => router.push('/inventory')}>إلغاء</Button>
                <Button type="submit" loading={submit.isPending}>حفظ الاستلام</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
