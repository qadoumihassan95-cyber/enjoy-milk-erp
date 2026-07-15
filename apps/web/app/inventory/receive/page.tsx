'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Truck, ArrowRight, Plus, Search, X, PackagePlus } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Badge } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/api';

/* ─────────────────────────────────────────────
   الوحدات المدعومة في نافذة "إضافة مادة"
──────────────────────────────────────────── */
const UNITS: { value: string; label: string; group: string; hint?: string }[] = [
  { value: 'PCS',    label: 'حبة',       group: 'عام' },
  { value: 'CTN',    label: 'كرتون',     group: 'عام' },
  { value: 'PACK',   label: 'عبوة',      group: 'عام' },
  { value: 'KG',     label: 'كيلوغرام',  group: 'وزن' },
  { value: 'G',      label: 'غرام',      group: 'وزن' },
  { value: 'L',      label: 'لتر',       group: 'سائل' },
  { value: 'ML',     label: 'ملليلتر',   group: 'سائل' },
  { value: 'BAG',    label: 'شوال',      group: 'مواد خام', hint: '1 شوال = 25 كغ افتراضياً' },
  { value: 'ROLL',   label: 'رول',       group: 'مواد خام', hint: 'قابل للتسجيل بالكغ/غ' },
  { value: 'CUSTOM', label: 'وحدة مخصصة', group: 'عام' },
];

const CATEGORIES = ['حليب خام', 'كرتون', 'ألمنيوم', 'منتج نهائي', 'مستهلكات', 'تغليف', 'أخرى'];

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

  // ─── مخزن واحد فقط في هذا المصنع: نُلغي حقل المستودع من الواجهة تماماً.
  //     الـ backend يُعيّن "المخزن الرئيسي" تلقائياً عند غياب warehouseId.
  const [form, setForm] = useState({
    itemId: '',
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

  // ─── قائمة المواد (تُعرض غير الفعالة عند التفعيل فقط) ──────
  const [itemSearch, setItemSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [showAddItem, setShowAddItem] = useState(false);

  const { data: items } = useQuery({
    queryKey: ['items-all', showInactive],
    queryFn: () =>
      api
        .get('/inventory/items', { params: { includeInactive: showInactive ? 1 : 0 } })
        .then((r) => r.data),
  });

  // ملاحظة: مخزن واحد فقط. لا نحتاج listWarehouses في الواجهة.

  const { data: suppliers } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.get('/inventory/suppliers').then((r) => r.data),
  });

  const filteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    const list = (items ?? []).filter((it: any) => {
      if (!showInactive && it.active === false) return false;
      if (!q) return true;
      return [it.name, it.nameEn, it.sku, it.barcode]
        .filter(Boolean)
        .some((v: string) => v.toLowerCase().includes(q));
    });
    return list.sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''));
  }, [items, itemSearch, showInactive]);

  const addSupplier = useMutation({
    mutationFn: (body: any) => api.post('/inventory/suppliers', body).then((r) => r.data),
    onSuccess: (res) => {
      toast.success('تم إضافة المورد');
      setForm((f) => ({ ...f, supplierId: res.id }));
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
        itemId: '', source: 'SUPPLIER', quantity: '', unitCost: '',
        supplierId: '', invoiceNumber: '', purchaseOrderNumber: '', batchNumber: '',
        serialNumber: '', productionDate: '', expiryDate: '', notes: '',
      });
      qc.invalidateQueries({ queryKey: ['inv-dashboard'] });
      qc.invalidateQueries({ queryKey: ['inv-items'] });
      qc.invalidateQueries({ queryKey: ['items-all'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'تعذّر الاستلام'),
  });

  const handle = (e: React.FormEvent) => {
    e.preventDefault();
    const qty = parseFloat(form.quantity);
    if (isNaN(qty) || qty <= 0) return toast.error('كمية غير صحيحة');
    if (!form.itemId) return toast.error('اختر المادة');
    // مخزن واحد فقط — الـ backend يُعيّن "المخزن الرئيسي" تلقائياً.
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
  const selectedItem = (items ?? []).find((i: any) => i.id === form.itemId);

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto p-3 md:p-6 space-y-4 md:space-y-6 pb-24 md:pb-6">
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

              {/* ─── اختيار المادة: بحث + زر إضافة مادة ─── */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-zinc-700">المادة *</label>
                  <button
                    type="button"
                    onClick={() => setShowAddItem(true)}
                    className="inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors"
                    title="أضف مادة جديدة دون مغادرة الصفحة"
                  >
                    <PackagePlus className="h-3.5 w-3.5" /> إضافة مادة جديدة
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2">
                  <div className="relative">
                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                    <input
                      value={itemSearch}
                      onChange={(e) => setItemSearch(e.target.value)}
                      placeholder="ابحث بالاسم أو SKU أو الباركود"
                      className="w-full h-10 pr-9 pl-3 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-xs font-bold text-zinc-600 px-2">
                    <input
                      type="checkbox"
                      checked={showInactive}
                      onChange={(e) => setShowInactive(e.target.checked)}
                    />
                    إظهار غير الفعالة
                  </label>
                  <div className="text-[11px] text-zinc-400 self-center" data-numeric>
                    {filteredItems.length} مادة
                  </div>
                </div>
                <select
                  value={form.itemId}
                  onChange={(e) => setForm({ ...form, itemId: e.target.value })}
                  className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm mt-1"
                  required
                  size={Math.min(6, Math.max(2, filteredItems.length))}
                >
                  <option value="">— اختر مادة —</option>
                  {filteredItems.map((it: any) => (
                    <option key={it.id} value={it.id}>
                      {it.name}
                      {it.nameEn ? ` (${it.nameEn})` : ''}
                      {' · '}{unitLabel(it.unit)}
                      {it.sku ? ` · ${it.sku}` : ''}
                      {it.active === false ? ' — غير فعّالة' : ''}
                    </option>
                  ))}
                </select>
                {selectedItem && (
                  <div className="text-[11px] text-zinc-500 flex flex-wrap gap-2">
                    <Badge variant="default">{selectedItem.category || 'بلا تصنيف'}</Badge>
                    <span>الوحدة: <b>{unitLabel(selectedItem.unit)}</b></span>
                    {selectedItem.bagWeightKg && (
                      <span>· 1 شوال = <b>{Number(selectedItem.bagWeightKg)} كغ</b></span>
                    )}
                  </div>
                )}
              </div>

              {/* مخزن واحد فقط في المصنع — يُدار تلقائياً كـ "المخزن الرئيسي" */}
              <div className="rounded-lg bg-blue-50 border border-blue-100 p-2 text-[11px] text-blue-800 flex items-center gap-1">
                <span className="font-bold">📦</span> يُخزَّن في «المخزن الرئيسي / Main Warehouse» — المصنع يعمل بمخزن واحد فقط.
              </div>
              <div className="grid md:grid-cols-2 gap-4">
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

      {/* Modal: إضافة مادة جديدة */}
      {showAddItem && (
        <AddItemModal
          suppliers={suppliers ?? []}
          onClose={() => setShowAddItem(false)}
          onCreated={(created) => {
            toast.success('تم إضافة المادة');
            qc.invalidateQueries({ queryKey: ['items-all'] });
            // اختر المادة الجديدة تلقائياً في نموذج الاستلام
            setForm((f) => ({ ...f, itemId: created.id }));
            setShowAddItem(false);
          }}
        />
      )}
    </AppShell>
  );
}

function unitLabel(v: string): string {
  return UNITS.find((u) => u.value === v)?.label ?? v ?? 'حبة';
}

/* ═════════════════════════════════════════════
   Modal: إضافة مادة جديدة (يظهر داخل نفس الصفحة)
════════════════════════════════════════════ */
function AddItemModal({
  suppliers,
  onClose,
  onCreated,
}: {
  suppliers: any[];
  onClose: () => void;
  onCreated: (created: any) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: '',
    nameEn: '',
    category: '',
    unit: 'PCS',
    customUnit: '',
    sku: '',
    barcode: '',
    minStock: '',
    costPrice: '',
    defaultSupplierId: '',
    notes: '',
    active: true,
    // تحويلات
    bagWeightKg: '25',
    gramsPerUnit: '1000',
    packsPerCarton: '',
  });
  const [saving, setSaving] = useState(false);

  const isMilkBag = form.unit === 'BAG';
  const isCarton = form.unit === 'CTN';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('اسم المادة بالعربي مطلوب');
    setSaving(true);
    try {
      const unit = form.unit === 'CUSTOM' ? (form.customUnit || 'CUSTOM') : form.unit;
      const body: any = {
        name: form.name.trim(),
        nameEn: form.nameEn.trim() || undefined,
        category: form.category || undefined,
        type: guessType(form.category, unit),
        unit,
        sku: form.sku.trim() || undefined,
        barcode: form.barcode.trim() || undefined,
        minStock: form.minStock ? +form.minStock : undefined,
        costPrice: form.costPrice ? +form.costPrice : undefined,
        defaultSupplierId: form.defaultSupplierId || undefined,
        notes: form.notes.trim() || undefined,
        active: form.active,
      };
      if (isMilkBag && form.bagWeightKg) body.bagWeightKg = +form.bagWeightKg;
      if (form.unit === 'KG' || form.unit === 'G') {
        if (form.gramsPerUnit) body.gramsPerUnit = +form.gramsPerUnit;
      }
      if (isCarton && form.packsPerCarton) body.packsPerCarton = +form.packsPerCarton;
      const created = await api.post('/inventory/items', body).then((r) => r.data);
      onCreated(created);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'تعذّر حفظ المادة');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
      dir="rtl"
    >
      <div
        className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white flex items-center justify-between p-5 border-b border-zinc-100 z-10">
          <div className="flex items-center gap-2">
            <PackagePlus className="h-5 w-5 text-emerald-600" />
            <h3 className="font-bold text-lg">إضافة مادة جديدة</h3>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          {/* المعلومات الأساسية */}
          <div className="grid md:grid-cols-2 gap-4">
            <Input
              label="اسم المادة بالعربي *"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              autoFocus
              placeholder="مثال: حليب خام"
            />
            <Input
              label="الاسم بالإنجليزي"
              value={form.nameEn}
              onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
              placeholder="Raw milk"
            />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-700">التصنيف</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
              >
                <option value="">— اختر —</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-700">الوحدة الأساسية *</label>
              <select
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
                required
              >
                {['عام', 'وزن', 'سائل', 'مواد خام'].map((g) => (
                  <optgroup key={g} label={g}>
                    {UNITS.filter((u) => u.group === g).map((u) => (
                      <option key={u.value} value={u.value}>{u.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {UNITS.find((u) => u.value === form.unit)?.hint && (
                <p className="text-[11px] text-zinc-500">
                  {UNITS.find((u) => u.value === form.unit)?.hint}
                </p>
              )}
            </div>
          </div>

          {form.unit === 'CUSTOM' && (
            <Input
              label="اسم الوحدة المخصصة *"
              value={form.customUnit}
              onChange={(e) => setForm({ ...form, customUnit: e.target.value })}
              placeholder="حدّد اسم الوحدة (مثال: صندوق)"
            />
          )}

          {/* تحويلات الوحدات */}
          {(isMilkBag || form.unit === 'KG' || form.unit === 'G' || isCarton) && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3 space-y-3">
              <div className="text-xs font-bold text-emerald-800">تحويلات الوحدات</div>
              <div className="grid md:grid-cols-3 gap-3">
                {isMilkBag && (
                  <Input
                    label="وزن الشوال (كغ) *"
                    type="number"
                    step="0.01"
                    value={form.bagWeightKg}
                    onChange={(e) => setForm({ ...form, bagWeightKg: e.target.value })}
                    hint="افتراضي 25 كغ"
                  />
                )}
                {(form.unit === 'KG' || form.unit === 'G') && (
                  <Input
                    label="غرام لكل وحدة"
                    type="number"
                    step="1"
                    value={form.gramsPerUnit}
                    onChange={(e) => setForm({ ...form, gramsPerUnit: e.target.value })}
                    hint="1 كغ = 1000 غ"
                  />
                )}
                {isCarton && (
                  <Input
                    label="عدد الحبات داخل الكرتون"
                    type="number"
                    step="1"
                    value={form.packsPerCarton}
                    onChange={(e) => setForm({ ...form, packsPerCarton: e.target.value })}
                  />
                )}
              </div>
            </div>
          )}

          {/* SKU / Barcode / حد / سعر / مورد */}
          <div className="grid md:grid-cols-2 gap-4">
            <Input
              label="كود المادة (SKU)"
              value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
              placeholder="سيُولّد تلقائياً إن ترك فارغاً"
            />
            <Input
              label="الباركود"
              value={form.barcode}
              onChange={(e) => setForm({ ...form, barcode: e.target.value })}
            />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Input
              label="الحد الأدنى للمخزون"
              type="number"
              step="0.01"
              value={form.minStock}
              onChange={(e) => setForm({ ...form, minStock: e.target.value })}
            />
            <Input
              label="سعر الشراء الافتراضي (د.أ)"
              type="number"
              step="0.01"
              value={form.costPrice}
              onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-zinc-700">المورد الافتراضي</label>
            <select
              value={form.defaultSupplierId}
              onChange={(e) => setForm({ ...form, defaultSupplierId: e.target.value })}
              className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
            >
              <option value="">— اختياري —</option>
              {(suppliers ?? []).map((s: any) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <Input
            label="ملاحظات"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />

          <label className="flex items-center gap-2 text-sm font-bold text-zinc-700">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
            المادة فعّالة
          </label>

          <div className="flex justify-end gap-3 pt-2 border-t border-zinc-100">
            <Button type="button" variant="ghost" onClick={onClose}>إلغاء</Button>
            <Button type="submit" loading={saving} disabled={saving}>
              <Plus className="h-4 w-4" /> إضافة المادة
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function guessType(category: string, unit: string): string {
  if (category === 'منتج نهائي') return 'POWDER_RETAIL';
  if (category === 'حليب خام' || unit === 'BAG') return 'POWDER_BULK';
  if (category === 'كرتون' || category === 'ألمنيوم' || category === 'تغليف') return 'PACKAGING';
  return 'CONSUMABLE';
}
