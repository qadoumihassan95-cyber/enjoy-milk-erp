'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer, FileText, FileSpreadsheet } from 'lucide-react';
import { Card, Stat, Badge, Button } from '@/components/ui';
import { AppShell } from '@/components/app-shell';
import { api } from '@/lib/api';
import { formatDate, cn } from '@/lib/utils';

/**
 * تصدير صفوف إلى ملف CSV (يفتح مباشرة في Excel، يدعم العربية بفضل BOM).
 */
function exportToCsv(filename: string, rows: (string | number)[][]) {
  // BOM يضمن أن Excel يعرف أنه UTF-8 ويعرض العربية بشكل صحيح
  const BOM = '﻿';
  const csv =
    BOM +
    rows
      .map((row) =>
        row
          .map((cell) => {
            const s = String(cell ?? '');
            // اقتباس الخلية إذا حوت فاصلة أو علامة اقتباس أو سطر جديد
            if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
            return s;
          })
          .join(','),
      )
      .join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * تصدير تقرير يوم كامل: ملخص + جدول سجلات + إنتاج حسب الصنف.
 */
function exportDailyToCsv(date: string, daily: any, list: any[] | undefined) {
  if (!daily) return;
  const summary = daily.summary ?? {};
  const records = daily.records ?? [];

  const rows: (string | number)[][] = [];
  rows.push([`تقرير الإنتاج اليومي - ${date}`]);
  rows.push([`مصنع الدانا لمنتجات الحليب واللبن - Enjoy Milk`]);
  rows.push([]);

  rows.push(['ملخص اليوم']);
  rows.push(['عدد السجلات', daily.recordsCount ?? records.length]);
  rows.push(['إجمالي الكراتين المنتجة', summary.totalCartons ?? 0]);
  rows.push(['إجمالي الطبليات', summary.totalPallets ?? 0]);
  rows.push(['إجمالي الحليب الخام (L)', summary.totalMilk ?? 0]);
  rows.push(['إجمالي الكرتون المستهلك', summary.totalCartonUsage ?? 0]);
  rows.push(['إجمالي الألمنيوم المستهلك', summary.totalAluminum ?? 0]);
  rows.push([]);

  rows.push(['الإنتاج حسب الصنف']);
  rows.push(['الصنف', 'إجمالي الكراتين']);
  for (const [name, qty] of Object.entries(summary.productionByItem ?? {})) {
    rows.push([name, Number(qty)]);
  }
  rows.push([]);

  rows.push(['التوالف حسب الصنف']);
  rows.push(['الصنف', 'الكمية']);
  for (const [name, qty] of Object.entries(summary.wasteByItem ?? {})) {
    rows.push([name, Number(qty)]);
  }
  rows.push([]);

  rows.push(['سجلات اليوم']);
  rows.push([
    '#',
    'الشيفت',
    'المشغّل',
    'الماكينة',
    'كراتين منتجة',
    'توالف',
    'الحالة',
  ]);
  records.forEach((r: any, i: number) => {
    const cartons = (r.produced ?? []).reduce(
      (s: number, p: any) => s + Number(p.cartonsTotal || 0),
      0,
    );
    const waste = (r.wastages ?? []).reduce(
      (s: number, w: any) => s + Number(w.quantity || 0),
      0,
    );
    rows.push([
      i + 1,
      r.shift ?? '-',
      r.operatorName ?? '-',
      r.machineNumber ?? '-',
      cartons,
      waste,
      r.status === 'POSTED'
        ? 'مُرحَّل'
        : r.status === 'CANCELLED'
          ? 'ملغي'
          : 'مسودة',
    ]);
  });

  exportToCsv(`production-report-${date}.csv`, rows);
}

/**
 * تصدير قائمة السجلات في نطاق تاريخي.
 */
function exportListToCsv(list: any[], from: string, to: string) {
  const rows: (string | number)[][] = [];
  rows.push([`سجلات الإنتاج ${from} → ${to}`]);
  rows.push([]);
  rows.push([
    'التاريخ',
    'الشيفت',
    'المشغّل',
    'الماكينة',
    'كراتين منتجة',
    'طبليات',
    'كرتون مستهلك',
    'ألمنيوم مستهلك',
    'حليب خام (L)',
    'توالف',
    'الحالة',
  ]);
  list.forEach((r: any) => {
    const cartons = (r.produced ?? []).reduce(
      (s: number, p: any) => s + Number(p.cartonsTotal || 0),
      0,
    );
    const pallets = (r.produced ?? []).reduce(
      (s: number, p: any) => s + Number(p.palletsCount || 0),
      0,
    );
    const cartonUse = (r.cartonUsage ?? []).reduce(
      (s: number, c: any) => s + Number(c.quantity || 0),
      0,
    );
    const aluUse = (r.aluminumUsage ?? []).reduce(
      (s: number, a: any) => s + Number(a.quantity || 0),
      0,
    );
    const milkUse = (r.milkUsage ?? []).reduce(
      (s: number, m: any) => s + Number(m.quantity || 0),
      0,
    );
    const waste = (r.wastages ?? []).reduce(
      (s: number, w: any) => s + Number(w.quantity || 0),
      0,
    );
    rows.push([
      new Date(r.productionDate).toISOString().slice(0, 10),
      r.shift ?? '-',
      r.operatorName ?? '-',
      r.machineNumber ?? '-',
      cartons,
      pallets,
      cartonUse,
      aluUse,
      milkUse,
      waste,
      r.status === 'POSTED'
        ? 'مُرحَّل'
        : r.status === 'CANCELLED'
          ? 'ملغي'
          : 'مسودة',
    ]);
  });

  exportToCsv(`production-records-${from}_${to}.csv`, rows);
}

export default function ReportsPage() {
  const [tab, setTab] = useState<'production' | 'inventory' | 'orders'>('production');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
        <header>
          <h1 className="text-2xl md:text-3xl font-black tracking-tight">التقارير</h1>
          <p className="text-sm text-zinc-500 mt-0.5">إنتاج · مخزون · طلبيات — مع طباعة PDF</p>
        </header>

        <div className="flex gap-2 border-b border-zinc-200">
          {[
            { v: 'production', l: '📊 الإنتاج اليومي' },
            { v: 'inventory', l: '📦 المخزون' },
            { v: 'orders', l: '🛒 الطلبيات' },
          ].map((t) => (
            <button
              key={t.v}
              onClick={() => setTab(t.v as any)}
              className={cn(
                'px-4 py-2 text-sm font-bold border-b-2 transition-colors',
                tab === t.v
                  ? 'border-zinc-900 text-zinc-900'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700',
              )}
            >
              {t.l}
            </button>
          ))}
        </div>

        {tab === 'production' && <ProductionReport date={date} onDateChange={setDate} />}
        {tab === 'inventory' && <InventoryReport />}
        {tab === 'orders' && <OrdersReport />}
      </div>
    </AppShell>
  );
}

function ProductionReport({ date, onDateChange }: { date: string; onDateChange: (d: string) => void }) {
  // تقرير اليوم المُجمَّع
  const { data: daily } = useQuery({
    queryKey: ['report-production-daily', date],
    queryFn: () =>
      api.get(`/daily-production/report/daily?date=${date}`).then((r) => r.data),
  });

  // قائمة السجلات في نطاق التاريخ (آخر 30 يوم)
  const [range, setRange] = useState(() => {
    const to = new Date();
    const from = new Date(Date.now() - 30 * 86400000);
    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    };
  });

  const { data: list } = useQuery({
    queryKey: ['report-production-list', range.from, range.to],
    queryFn: () =>
      api
        .get(`/daily-production?from=${range.from}&to=${range.to}`)
        .then((r) => r.data),
  });

  const summary = daily?.summary ?? {};

  return (
    <div className="space-y-4">
      {/* ─── تقرير يومي مُجمَّع ────────────────────── */}
      <Card className="p-4 flex items-center gap-3 flex-wrap">
        <label className="text-sm font-bold">📅 تقرير اليوم:</label>
        <input
          type="date"
          value={date}
          onChange={(e) => onDateChange(e.target.value)}
          className="h-10 px-3 rounded-lg border border-zinc-200 text-sm"
        />
        <div className="flex-1" />
        <Button
          variant="outline"
          onClick={() => exportDailyToCsv(date, daily, list)}
          disabled={!daily}
          title="تصدير ملف Excel/CSV"
        >
          <FileSpreadsheet className="h-4 w-4" /> تصدير Excel
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            window.open(`/reports/daily/${date}`, '_blank', 'noopener')
          }
        >
          <FileText className="h-4 w-4" /> طباعة تقرير {formatDate(date)}
        </Button>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat label="السجلات" value={daily?.recordsCount ?? 0} />
        <Stat
          label="كراتين منتجة"
          value={(summary.totalCartons ?? 0).toLocaleString('en-US')}
        />
        <Stat
          label="طبليات"
          value={(summary.totalPallets ?? 0).toLocaleString('en-US')}
        />
        <Stat
          label="حليب خام"
          value={`${(summary.totalMilk ?? 0).toLocaleString('en-US')} L`}
        />
        <Stat
          label="كرتون مستهلك"
          value={(summary.totalCartonUsage ?? 0).toLocaleString('en-US')}
        />
      </div>

      {/* ─── قائمة السجلات + طباعة لكل واحد ─────────── */}
      <Card className="p-4">
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <h3 className="font-black text-lg">📋 سجلات الإنتاج</h3>
          <div className="flex-1" />
          <label className="text-xs text-zinc-500">من</label>
          <input
            type="date"
            value={range.from}
            onChange={(e) => setRange({ ...range, from: e.target.value })}
            className="h-9 px-2 rounded-lg border border-zinc-200 text-sm"
          />
          <label className="text-xs text-zinc-500">إلى</label>
          <input
            type="date"
            value={range.to}
            onChange={(e) => setRange({ ...range, to: e.target.value })}
            className="h-9 px-2 rounded-lg border border-zinc-200 text-sm"
          />
          <button
            onClick={() =>
              list && list.length > 0 && exportListToCsv(list, range.from, range.to)
            }
            disabled={!list || list.length === 0}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-zinc-200 hover:bg-zinc-100 disabled:opacity-40"
            title="تصدير القائمة للـ Excel"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
          </button>
        </div>

        {!list || list.length === 0 ? (
          <p className="text-sm text-zinc-400 text-center py-8">
            لا توجد سجلات في هذا النطاق
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-right p-2 text-[10px] font-bold uppercase">
                    التاريخ
                  </th>
                  <th className="text-right p-2 text-[10px] font-bold uppercase">
                    الشيفت
                  </th>
                  <th className="text-right p-2 text-[10px] font-bold uppercase">
                    المشغّل
                  </th>
                  <th className="text-right p-2 text-[10px] font-bold uppercase">
                    الماكينة
                  </th>
                  <th className="text-right p-2 text-[10px] font-bold uppercase">
                    كراتين منتجة
                  </th>
                  <th className="text-right p-2 text-[10px] font-bold uppercase">
                    التوالف
                  </th>
                  <th className="text-right p-2 text-[10px] font-bold uppercase">
                    الحالة
                  </th>
                  <th className="text-right p-2 text-[10px] font-bold uppercase">
                    إجراء
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((r: any) => {
                  const cartons = (r.produced ?? []).reduce(
                    (s: number, p: any) => s + Number(p.cartonsTotal || 0),
                    0,
                  );
                  const waste = (r.wastages ?? []).reduce(
                    (s: number, w: any) => s + Number(w.quantity || 0),
                    0,
                  );
                  return (
                    <tr key={r.id} className="border-b hover:bg-zinc-50">
                      <td className="p-2 font-medium">
                        {formatDate(r.productionDate)}
                      </td>
                      <td className="p-2 text-xs">{r.shift || '—'}</td>
                      <td className="p-2 text-xs">{r.operatorName || '—'}</td>
                      <td className="p-2 text-xs" data-numeric>
                        {r.machineNumber || '—'}
                      </td>
                      <td className="p-2 font-bold" data-numeric>
                        {cartons.toLocaleString('en-US')}
                      </td>
                      <td
                        className={cn(
                          'p-2',
                          waste > 0 ? 'text-amber-600 font-bold' : 'text-zinc-400',
                        )}
                        data-numeric
                      >
                        {waste.toLocaleString('en-US')}
                      </td>
                      <td className="p-2">
                        {r.status === 'POSTED' ? (
                          <Badge variant="success" dot>
                            مُرحَّل
                          </Badge>
                        ) : r.status === 'CANCELLED' ? (
                          <Badge variant="danger" dot>
                            ملغي
                          </Badge>
                        ) : (
                          <Badge variant="warning" dot>
                            مسودة
                          </Badge>
                        )}
                      </td>
                      <td className="p-2">
                        <button
                          onClick={() =>
                            window.open(
                              `/production/${r.id}/print`,
                              '_blank',
                              'noopener',
                            )
                          }
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-zinc-200 hover:bg-zinc-100"
                        >
                          <Printer className="h-3 w-3" /> طباعة
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ─── ملخص الإنتاج اليومي حسب الصنف ──────────── */}
      {daily && Object.keys(summary.productionByItem ?? {}).length > 0 && (
        <Card className="p-5">
          <h3 className="font-black text-lg mb-3">
            🥛 الإنتاج حسب الصنف ({formatDate(date)})
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-right p-2 text-[10px] font-bold uppercase">
                  الصنف
                </th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">
                  إجمالي الكراتين
                </th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(summary.productionByItem).map(([name, qty]: any) => (
                <tr key={name} className="border-b">
                  <td className="p-2 font-medium">{name}</td>
                  <td className="p-2 font-bold" data-numeric>
                    {Number(qty).toLocaleString('en-US')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function InventoryReport() {
  const { data: items } = useQuery({
    queryKey: ['inventory-items'],
    queryFn: () => api.get('/inventory/items').then((r) => r.data),
  });

  const raw = items?.filter((i: any) => ['POWDER_BULK', 'PACKAGING', 'CONSUMABLE'].includes(i.type)) ?? [];
  const finished = items?.filter((i: any) => i.type === 'POWDER_RETAIL') ?? [];

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h3 className="font-black text-lg mb-3">📦 المواد الخام والتغليف</h3>
        {raw.length === 0 ? <p className="text-sm text-zinc-400 text-center py-4">لا توجد</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b">
                <th className="text-right p-2 text-[10px] font-bold uppercase">SKU</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">الاسم</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">النوع</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">الكمية</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">الحالة</th>
              </tr></thead>
              <tbody>
                {raw.map((it: any) => (
                  <tr key={it.id} className="border-b">
                    <td className="p-2 font-mono text-xs">{it.sku}</td>
                    <td className="p-2 font-medium">{it.name}</td>
                    <td className="p-2"><Badge>{it.type}</Badge></td>
                    <td className="p-2 font-bold" data-numeric>{it.totalStock} {it.unit}</td>
                    <td className="p-2">{it.isLow ? <Badge variant="warning" dot>منخفض</Badge> : <Badge variant="success" dot>متوفر</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h3 className="font-black text-lg mb-3">🥛 المنتجات الجاهزة</h3>
        {finished.length === 0 ? <p className="text-sm text-zinc-400 text-center py-4">لا توجد</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b">
                <th className="text-right p-2 text-[10px] font-bold uppercase">SKU</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">الاسم</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">الكمية</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">السعر</th>
              </tr></thead>
              <tbody>
                {finished.map((it: any) => (
                  <tr key={it.id} className="border-b">
                    <td className="p-2 font-mono text-xs">{it.sku}</td>
                    <td className="p-2 font-medium">{it.name}</td>
                    <td className="p-2 font-bold" data-numeric>{it.totalStock} {it.unit}</td>
                    <td className="p-2" data-numeric>{it.sellPrice ? `${Number(it.sellPrice).toFixed(2)} د.أ` : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function OrdersReport() {
  const { data } = useQuery({
    queryKey: ['orders-report-full'],
    queryFn: () => api.get('/orders/report').then((r) => r.data),
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="عدد الطلبيات" value={data?.ordersCount ?? 0} />
        <Stat label="الإجمالي" value={(data?.totalAmount ?? 0).toFixed(0)} unit="د.أ" />
        <Stat label="المدفوع" value={(data?.totalPaid ?? 0).toFixed(0)} unit="د.أ" state="good" />
        <Stat label="المتبقي" value={(data?.totalBalance ?? 0).toFixed(0)} unit="د.أ" state={(data?.totalBalance ?? 0) > 0 ? 'warning' : 'good'} />
      </div>

      <Card className="p-5">
        <h3 className="font-bold mb-3">⚠️ الطلبيات غير المكتملة الدفع</h3>
        {!data?.unpaidOrders || data.unpaidOrders.length === 0 ? (
          <p className="text-sm text-zinc-400 text-center py-4">كل الطلبيات مدفوعة 🎉</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b">
                <th className="text-right p-2 text-[10px] font-bold uppercase">رقم</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">العميل</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">الإجمالي</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">المدفوع</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">المتبقي</th>
              </tr></thead>
              <tbody>
                {data.unpaidOrders.map((o: any) => (
                  <tr key={o.id} className="border-b">
                    <td className="p-2 font-mono text-xs">{o.number}</td>
                    <td className="p-2 font-medium">{o.customerName}</td>
                    <td className="p-2 font-bold" data-numeric>{o.total.toFixed(2)}</td>
                    <td className="p-2 text-emerald-700" data-numeric>{o.paid.toFixed(2)}</td>
                    <td className="p-2 font-bold text-amber-600" data-numeric>{o.balance.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
