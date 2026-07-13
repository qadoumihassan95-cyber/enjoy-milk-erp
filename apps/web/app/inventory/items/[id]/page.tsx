'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Package, Save, Wrench, Truck, History, Warehouse, Settings2 } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Badge, Stat } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/api';
import { formatNumber, formatDate } from '@/lib/utils';

const TYPE_LABEL: Record<string, string> = {
  POWDER_BULK: 'بودرة بالجملة',
  PACKAGING: 'مواد تغليف',
  POWDER_RETAIL: 'منتج نهائي',
  CONSUMABLE: 'مستهلكات',
};

export default function ItemDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const toast = useToast();
  const qc = useQueryClient();

  const { data: analytics } = useQuery({
    queryKey: ['item-analytics', id],
    queryFn: () => api.get(`/inventory/items/${id}/analytics`).then((r) => r.data),
    enabled: !!id,
  });

  const { data: history } = useQuery({
    queryKey: ['item-history', id],
    queryFn: () => api.get(`/inventory/items/${id}/movements`).then((r) => r.data),
    enabled: !!id,
  });

  const item = analytics?.item;
  const [settings, setSettings] = useState({
    minStock: '', maxStock: '', reorderPoint: '', productionReorderLevel: '',
    reorderQty: '', safetyStock: '', leadTimeDays: '',
  });

  useEffect(() => {
    if (!item) return;
    setSettings({
      minStock: item.minStock != null ? String(item.minStock) : '',
      maxStock: item.maxStock != null ? String(item.maxStock) : '',
      reorderPoint: item.reorderPoint != null ? String(item.reorderPoint) : (item.reorderLevel != null ? String(item.reorderLevel) : ''),
      productionReorderLevel: item.productionReorderLevel != null ? String(item.productionReorderLevel) : '',
      reorderQty: item.reorderQty != null ? String(item.reorderQty) : '',
      safetyStock: item.safetyStock != null ? String(item.safetyStock) : '',
      leadTimeDays: item.leadTimeDays != null ? String(item.leadTimeDays) : '',
    });
  }, [item]);

  const saveSettings = useMutation({
    mutationFn: (body: any) => api.patch(`/inventory/items/${id}/settings`, body).then((r) => r.data),
    onSuccess: () => {
      toast.success('تم حفظ الإعدادات');
      qc.invalidateQueries({ queryKey: ['item-analytics', id] });
      qc.invalidateQueries({ queryKey: ['inv-dashboard'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'تعذّر الحفظ'),
  });

  if (!analytics) {
    return (
      <AppShell>
        <div className="max-w-5xl mx-auto p-8 text-center text-zinc-500">جاري التحميل...</div>
      </AppShell>
    );
  }

  const status = analytics.status;
  const statusBadge =
    status === 'OUT_OF_STOCK' ? <Badge variant="danger" dot>منتهي</Badge>
    : status === 'CRITICAL' ? <Badge variant="danger" dot>حرج</Badge>
    : status === 'LOW' ? <Badge variant="warning" dot>منخفض</Badge>
    : <Badge variant="success" dot>متوفر</Badge>;

  const movements = history?.movements ?? [];
  const adjustments = history?.adjustments ?? [];
  const receipts = history?.receipts ?? [];

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
        <header>
          <button onClick={() => router.push('/inventory')} className="text-sm text-zinc-500 mb-2 flex items-center gap-1 hover:text-zinc-900">
            <ArrowRight className="h-4 w-4 rotate-180" /> العودة للمخزون
          </button>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-zinc-900 text-white flex items-center justify-center">
                <Package className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-black tracking-tight flex items-center gap-2">
                  {item.name} {statusBadge}
                </h1>
                <p className="text-sm text-zinc-500 mt-0.5 font-mono">
                  {item.sku} · {TYPE_LABEL[item.type] ?? item.type} · وحدة: {item.unit}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => router.push('/inventory/adjust')}>
                <Wrench className="h-4 w-4" /> تعديل
              </Button>
              <Button onClick={() => router.push('/inventory/receive')}>
                <Truck className="h-4 w-4" /> استلام
              </Button>
            </div>
          </div>
        </header>

        {/* KPIs */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="الكمية الحالية" value={formatNumber(analytics.totalStock, 0)} unit={item.unit} />
          <Stat label="القيمة الإجمالية" value={formatNumber(analytics.totalValue, 0)} unit="د.أ" state="good" />
          <Stat label="آخر سعر شراء" value={item.lastPurchasePrice != null ? formatNumber(item.lastPurchasePrice, 2) : '—'} unit="د.أ" />
          <Stat label="متوسط التكلفة" value={item.avgCost != null ? formatNumber(item.avgCost, 2) : '—'} unit="د.أ" />
        </section>

        {/* Stock by warehouse */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Warehouse className="h-4 w-4" /> الكمية في كل مستودع</CardTitle>
          </CardHeader>
          <CardContent>
            {analytics.stockByWarehouse.length === 0 ? (
              <p className="text-sm text-zinc-400 text-center py-4">لا يوجد رصيد</p>
            ) : (
              <div className="grid md:grid-cols-3 gap-2">
                {analytics.stockByWarehouse.map((s: any) => (
                  <div key={s.warehouseId} className="rounded-lg border border-zinc-100 p-3 flex justify-between items-center">
                    <div className="text-sm font-medium">{s.warehouseName}</div>
                    <div className="text-lg font-black" data-numeric>{formatNumber(s.quantity, 0)}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Settings2 className="h-4 w-4" /> إعدادات المخزون</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-3 gap-4">
              <Input label="الحد الأدنى" type="number" step="0.001" value={settings.minStock}
                onChange={(e) => setSettings({ ...settings, minStock: e.target.value })} />
              <Input label="الحد الأقصى" type="number" step="0.001" value={settings.maxStock}
                onChange={(e) => setSettings({ ...settings, maxStock: e.target.value })} />
              <Input label="نقطة إعادة الطلب" type="number" step="0.001" value={settings.reorderPoint}
                onChange={(e) => setSettings({ ...settings, reorderPoint: e.target.value })} />
              <Input
                label="نقطة إعادة طلب الإنتاج"
                type="number" step="0.001"
                value={settings.productionReorderLevel}
                onChange={(e) => setSettings({ ...settings, productionReorderLevel: e.target.value })}
                hint="تُستخدم لتخطيط الإنتاج (مستقلة عن إعادة الشراء)"
              />
              <Input label="كمية إعادة الطلب" type="number" step="0.001" value={settings.reorderQty}
                onChange={(e) => setSettings({ ...settings, reorderQty: e.target.value })} />
              <Input label="مخزون الأمان" type="number" step="0.001" value={settings.safetyStock}
                onChange={(e) => setSettings({ ...settings, safetyStock: e.target.value })} />
              <Input label="مدة التوريد (أيام)" type="number" step="1" value={settings.leadTimeDays}
                onChange={(e) => setSettings({ ...settings, leadTimeDays: e.target.value })} />
            </div>
            <div className="flex justify-end mt-4">
              <Button loading={saveSettings.isPending} onClick={() => saveSettings.mutate(settings)}>
                <Save className="h-4 w-4" /> حفظ الإعدادات
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* History (movements + adjustments + receipts) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><History className="h-4 w-4" /> سجل حركة المادة</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 border-b sticky top-0">
                  <tr>
                    <th className="text-right p-2.5 text-[10px] font-bold text-zinc-500 uppercase">التاريخ</th>
                    <th className="text-right p-2.5 text-[10px] font-bold text-zinc-500 uppercase">النوع</th>
                    <th className="text-right p-2.5 text-[10px] font-bold text-zinc-500 uppercase">الكمية</th>
                    <th className="text-right p-2.5 text-[10px] font-bold text-zinc-500 uppercase">قبل → بعد</th>
                    <th className="text-right p-2.5 text-[10px] font-bold text-zinc-500 uppercase">التفاصيل</th>
                  </tr>
                </thead>
                <tbody>
                  {adjustments.map((a: any) => (
                    <tr key={`a-${a.id}`} className="border-b border-zinc-100">
                      <td className="p-2.5 text-zinc-500 whitespace-nowrap">{formatDate(a.createdAt)}</td>
                      <td className="p-2.5"><span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">{a.type}</span></td>
                      <td className="p-2.5 font-bold" data-numeric>{Number(a.quantity) >= 0 ? '+' : ''}{formatNumber(a.quantity, 1)}</td>
                      <td className="p-2.5 text-zinc-600" data-numeric>{a.quantityBefore != null ? `${formatNumber(a.quantityBefore, 0)} → ${formatNumber(a.quantityAfter, 0)}` : '—'}</td>
                      <td className="p-2.5 text-zinc-600 text-xs">{a.reason}{a.notes ? ` — ${a.notes}` : ''}</td>
                    </tr>
                  ))}
                  {receipts.map((r: any) => (
                    <tr key={`r-${r.id}`} className="border-b border-zinc-100">
                      <td className="p-2.5 text-zinc-500 whitespace-nowrap">{formatDate(r.createdAt)}</td>
                      <td className="p-2.5"><span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">استلام {r.source}</span></td>
                      <td className="p-2.5 font-bold text-emerald-700" data-numeric>+{formatNumber(r.quantity, 0)}</td>
                      <td className="p-2.5 text-zinc-600" data-numeric>{r.unitCost != null ? `تكلفة: ${formatNumber(r.unitCost, 2)}` : '—'}</td>
                      <td className="p-2.5 text-zinc-600 text-xs">
                        {r.supplier?.name ? `مورد: ${r.supplier.name}` : ''}
                        {r.invoiceNumber ? ` · فاتورة: ${r.invoiceNumber}` : ''}
                        {r.batchNumber ? ` · تشغيلة: ${r.batchNumber}` : ''}
                      </td>
                    </tr>
                  ))}
                  {movements.map((m: any) => (
                    <tr key={`m-${m.id}`} className="border-b border-zinc-100">
                      <td className="p-2.5 text-zinc-500 whitespace-nowrap">{formatDate(m.performedAt)}</td>
                      <td className="p-2.5"><span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-zinc-100">{m.type}</span></td>
                      <td className="p-2.5 font-bold" data-numeric>{formatNumber(m.quantity, 0)}</td>
                      <td className="p-2.5 text-zinc-600 text-xs">{m.fromWarehouse?.name ? `من: ${m.fromWarehouse.name}` : ''}{m.toWarehouse?.name ? ` إلى: ${m.toWarehouse.name}` : ''}</td>
                      <td className="p-2.5 text-zinc-600 text-xs">{m.reasonCode || m.notes || '—'}</td>
                    </tr>
                  ))}
                  {(!adjustments.length && !receipts.length && !movements.length) && (
                    <tr><td colSpan={5} className="p-8 text-center text-zinc-400 text-sm">لا يوجد سجل حركة بعد</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
