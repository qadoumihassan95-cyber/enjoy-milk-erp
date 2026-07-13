'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from '@/components/ui';
import { api } from '@/lib/api';

export default function NewItemPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    sku: '',
    barcode: '',
    name: '',
    type: 'POWDER_RETAIL',
    unit: 'PCS',
    netWeightGrams: '',
    packagingFormat: 'SACHET',
    packsPerCarton: '',
    shelfLifeDays: '',
    reorderLevel: '',
    productionReorderLevel: '',
    costPrice: '',
    sellPrice: '',
  });

  const update = (k: string, v: string) => setForm({ ...form, [k]: v });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post('/inventory/items', {
        ...form,
        netWeightGrams: form.netWeightGrams ? +form.netWeightGrams : undefined,
        packsPerCarton: form.packsPerCarton ? +form.packsPerCarton : undefined,
        shelfLifeDays: form.shelfLifeDays ? +form.shelfLifeDays : undefined,
        reorderLevel: form.reorderLevel ? +form.reorderLevel : undefined,
        productionReorderLevel: form.productionReorderLevel ? +form.productionReorderLevel : undefined,
        costPrice: form.costPrice ? +form.costPrice : undefined,
        sellPrice: form.sellPrice ? +form.sellPrice : undefined,
      });
      router.push('/inventory');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'فشل الحفظ');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto p-4 md:p-6">
        <header className="mb-6">
          <button
            onClick={() => router.back()}
            className="text-sm text-zinc-500 mb-2 flex items-center gap-1 hover:text-zinc-900"
          >
            <ArrowRight className="h-4 w-4 rotate-180" />
            رجوع
          </button>
          <div className="flex items-baseline justify-between flex-wrap gap-3">
            <h1 className="text-2xl md:text-3xl font-black tracking-tight">صنف جديد</h1>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => router.push('/inventory/receive')}
                className="px-3 py-1.5 rounded-md text-xs font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-100 transition-colors"
              >
                إعادة الطلب (استلام)
              </button>
              <button
                type="button"
                onClick={() => router.push('/production')}
                className="px-3 py-1.5 rounded-md text-xs font-bold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-100 transition-colors"
                title="ابدأ عملية إنتاج جديدة مع تعبئة الصنف تلقائياً"
              >
                إعادة الإنتاج
              </button>
            </div>
          </div>
        </header>

        <form onSubmit={submit}>
          <Card>
            <CardHeader>
              <CardTitle>المعلومات الأساسية</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <Input
                  label="SKU *"
                  value={form.sku}
                  onChange={(e) => update('sku', e.target.value)}
                  placeholder="RT-FF-250"
                  required
                />
                <Input
                  label="الباركود"
                  value={form.barcode}
                  onChange={(e) => update('barcode', e.target.value)}
                />
              </div>
              <Input
                label="الاسم *"
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                required
              />
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-zinc-700 block">النوع *</label>
                  <select
                    value={form.type}
                    onChange={(e) => update('type', e.target.value)}
                    className="w-full rounded-lg border border-zinc-200 bg-white h-10 px-3 text-sm"
                  >
                    <option value="POWDER_BULK">بودرة مستوردة</option>
                    <option value="PACKAGING">تغليف</option>
                    <option value="POWDER_RETAIL">منتج نهائي</option>
                    <option value="CONSUMABLE">مستهلكات</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-zinc-700 block">الوحدة *</label>
                  <select
                    value={form.unit}
                    onChange={(e) => update('unit', e.target.value)}
                    className="w-full rounded-lg border border-zinc-200 bg-white h-10 px-3 text-sm"
                  >
                    <optgroup label="عام">
                      <option value="PCS">حبة</option>
                      <option value="CTN">كرتون</option>
                      <option value="PAL">طبلية</option>
                    </optgroup>
                    <optgroup label="الحليب">
                      <option value="KG">كيلوغرام (كغ)</option>
                      <option value="G">غرام</option>
                      <option value="BAG">كيس (25 كغ)</option>
                    </optgroup>
                    <optgroup label="ألمنيوم">
                      <option value="KG_ALU">كيلوغرام ألمنيوم</option>
                    </optgroup>
                  </select>
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <Input
                  label="الوزن (غرام)"
                  type="number"
                  value={form.netWeightGrams}
                  onChange={(e) => update('netWeightGrams', e.target.value)}
                />
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-zinc-700 block">التغليف</label>
                  <select
                    value={form.packagingFormat}
                    onChange={(e) => update('packagingFormat', e.target.value)}
                    className="w-full rounded-lg border border-zinc-200 bg-white h-10 px-3 text-sm"
                  >
                    <option value="SACHET">ظرف</option>
                    <option value="TIN">تنك</option>
                    <option value="POUCH">كيس</option>
                    <option value="JAR">برطمان</option>
                    <option value="BULK_BAG">كيس بالجملة</option>
                  </select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle>الأسعار والمخزون</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <Input
                  label="حد إعادة الطلب"
                  type="number"
                  value={form.reorderLevel}
                  onChange={(e) => update('reorderLevel', e.target.value)}
                  hint="حد أدنى قبل التنبيه بإعادة الشراء"
                />
                <Input
                  label="حد إعادة طلب الإنتاج"
                  type="number"
                  value={form.productionReorderLevel}
                  onChange={(e) => update('productionReorderLevel', e.target.value)}
                  hint="يُستخدم لتخطيط الإنتاج (مستقل عن إعادة الشراء)"
                />
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <Input
                  label="مدة الصلاحية (يوم)"
                  type="number"
                  value={form.shelfLifeDays}
                  onChange={(e) => update('shelfLifeDays', e.target.value)}
                />
                <Input
                  label="حبات في الكرتون"
                  type="number"
                  value={form.packsPerCarton}
                  onChange={(e) => update('packsPerCarton', e.target.value)}
                />
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <Input
                  label="سعر التكلفة (د.أ)"
                  type="number"
                  step="0.01"
                  value={form.costPrice}
                  onChange={(e) => update('costPrice', e.target.value)}
                />
                <Input
                  label="سعر البيع (د.أ)"
                  type="number"
                  step="0.01"
                  value={form.sellPrice}
                  onChange={(e) => update('sellPrice', e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          {error && (
            <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="mt-6 flex gap-3 justify-end">
            <Button type="button" variant="ghost" onClick={() => router.back()}>
              إلغاء
            </Button>
            <Button type="submit" loading={loading}>
              حفظ الصنف
            </Button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
