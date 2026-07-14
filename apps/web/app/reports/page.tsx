'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Printer,
  FileText,
  FileSpreadsheet,
  RefreshCw,
  Search,
  BarChart3,
  Package,
  ShoppingCart,
  Wallet,
  Factory,
  ArrowLeftRight,
} from 'lucide-react';
import { Card, Stat, Badge, Button } from '@/components/ui';
import { AppShell } from '@/components/app-shell';
import { api } from '@/lib/api';
import { formatDate, cn } from '@/lib/utils';
import { FACTORY_NAME } from '@/lib/branding';

/* ─────────────────────────────────────────────────────
   Utilities: CSV export + shared print helper
──────────────────────────────────────────────────── */
function exportToCsv(filename: string, rows: (string | number)[][]) {
  const BOM = '﻿';
  const csv = BOM + rows.map((r) => r.map(csvCell).join(',')).join('\n');
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
function csvCell(cell: any): string {
  const s = String(cell ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function currentReportPrint(sectionId: string) {
  // نطبع فقط قسم التقرير المطلوب: نُخفي كل شيء ثم نُظهر القسم المحدد.
  const html = document.getElementById(sectionId)?.outerHTML;
  if (!html) return window.print();
  const w = window.open('', '_blank', 'noopener,width=1000,height=800');
  if (!w) return;
  w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
    <title>${document.title} — طباعة</title>
    <style>
      @page { size: A4 portrait; margin: 14mm 12mm; }
      * { box-sizing: border-box; }
      body { font-family: 'Cairo','Tahoma',sans-serif; color: #18181b; margin: 0; padding: 0; direction: rtl; }
      .print-header { text-align: center; padding-bottom: 10px; border-bottom: 2px solid #18181b; margin-bottom: 12px; }
      .print-header h1 { font-size: 20px; margin: 0 0 4px; font-weight: 900; }
      .print-header .sub { font-size: 12px; color: #52525b; }
      .filters-line { font-size: 11px; color: #71717a; margin: 6px 0 14px; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; }
      thead { display: table-header-group; }         /* تكرار الرأس على كل صفحة */
      tr, td, th { page-break-inside: avoid; }
      th, td { border: 1px solid #e4e4e7; padding: 6px 8px; text-align: right; }
      th { background: #f4f4f5; font-weight: 800; font-size: 10px; text-transform: uppercase; }
      tfoot td { font-weight: 900; background: #fafafa; }
      .kpis { display: grid; grid-template-columns: repeat(4,1fr); gap: 8px; margin: 8px 0 14px; }
      .kpi { border: 1px solid #e4e4e7; border-radius: 8px; padding: 8px; }
      .kpi .k-label { font-size: 10px; color: #71717a; }
      .kpi .k-value { font-size: 16px; font-weight: 900; }
      .foot { position: fixed; bottom: 6mm; left: 0; right: 0; text-align: center; font-size: 10px; color: #a1a1aa; }
      .no-print, nav, header.appshell { display: none !important; }
      @media print { .foot { display: block; } }
    </style></head><body>
    <div class="print-header">
      <h1>${FACTORY_NAME}</h1>
      <div class="sub">${document.title}</div>
      <div class="sub">${new Date().toLocaleString('ar-JO')}</div>
    </div>
    ${html}
    <div class="foot">مصنع الدانة لمنتجات الحليب — تُطبع الصفحات آلياً</div>
    <script>window.onload = () => { setTimeout(() => { window.print(); }, 300); };</script>
    </body></html>`);
  w.document.close();
}

/* ─────────────────────────────────────────────────────
   الصفحة الرئيسية
──────────────────────────────────────────────────── */
type TabKey = 'production' | 'inventory' | 'orders' | 'sales' | 'costwaste' | 'movement';

export default function ReportsPage() {
  const [tab, setTab] = useState<TabKey>('production');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const tabs: { v: TabKey; l: string; Icon: any }[] = [
    { v: 'production', l: 'الإنتاج اليومي', Icon: BarChart3 },
    { v: 'inventory', l: 'المخزون', Icon: Package },
    { v: 'orders', l: 'الطلبيات', Icon: ShoppingCart },
    { v: 'sales', l: 'المبيعات والتحصيلات', Icon: Wallet },
    { v: 'costwaste', l: 'تكلفة الإنتاج والهدر', Icon: Factory },
    { v: 'movement', l: 'حركة المخزون', Icon: ArrowLeftRight },
  ];

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
        <header>
          <h1 className="text-2xl md:text-3xl font-black tracking-tight">التقارير</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            {FACTORY_NAME} · ست تقارير كاملة مع طباعة A4 وتصدير Excel
          </p>
        </header>

        <div className="flex gap-2 border-b border-zinc-200 overflow-x-auto">
          {tabs.map((t) => {
            const Ic = t.Icon;
            return (
              <button
                key={t.v}
                onClick={() => setTab(t.v)}
                className={cn(
                  'px-3 py-2 text-sm font-bold border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5',
                  tab === t.v
                    ? 'border-zinc-900 text-zinc-900'
                    : 'border-transparent text-zinc-500 hover:text-zinc-700',
                )}
              >
                <Ic className="h-4 w-4" /> {t.l}
              </button>
            );
          })}
        </div>

        {tab === 'production' && <ProductionReport date={date} onDateChange={setDate} />}
        {tab === 'inventory' && <InventoryReport />}
        {tab === 'orders' && <OrdersReport />}
        {tab === 'sales' && <SalesReport />}
        {tab === 'costwaste' && <CostWasteReport />}
        {tab === 'movement' && <MovementReport />}
      </div>
    </AppShell>
  );
}

/* ═════════════════════════════════════════════
   1) PRODUCTION REPORT  (كان موجوداً — نُبقيه كما هو مع تصدير)
════════════════════════════════════════════ */
function ProductionReport({ date, onDateChange }: { date: string; onDateChange: (d: string) => void }) {
  const { data: daily } = useQuery({
    queryKey: ['report-production-daily', date],
    queryFn: () =>
      api.get(`/daily-production/report/daily?date=${date}`).then((r) => r.data),
  });

  const [range, setRange] = useState(() => {
    const to = new Date();
    const from = new Date(Date.now() - 30 * 86400000);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  });
  const { data: list } = useQuery({
    queryKey: ['report-production-list', range.from, range.to],
    queryFn: () =>
      api.get(`/daily-production?from=${range.from}&to=${range.to}`).then((r) => r.data),
  });

  const summary = daily?.summary ?? {};

  return (
    <div className="space-y-4">
      <Card className="p-4 flex items-center gap-3 flex-wrap no-print">
        <label className="text-sm font-bold">📅 تقرير اليوم:</label>
        <input type="date" value={date} onChange={(e) => onDateChange(e.target.value)}
          className="h-10 px-3 rounded-lg border border-zinc-200 text-sm" />
        <div className="flex-1" />
        <Button variant="outline" onClick={() =>
          window.open(`/reports/daily/${date}`, '_blank', 'noopener')
        }>
          <Printer className="h-4 w-4" /> طباعة تقرير {formatDate(date)}
        </Button>
      </Card>

      <div id="print-production-summary">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="عدد السجلات" value={daily?.recordsCount ?? 0} />
          <Stat label="إجمالي الكراتين" value={summary.totalCartons ?? 0} state="good" />
          <Stat label="إجمالي الحليب (كغ)" value={(summary.totalMilkKg ?? summary.totalMilk ?? 0)} />
          <Stat label="التوالف" value={summary.totalWaste ?? 0} state={(summary.totalWaste ?? 0) > 0 ? 'warning' : 'good'} />
        </div>
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3 no-print">
          <h3 className="font-black text-lg">📋 سجلات الفترة</h3>
          <div className="flex gap-2 items-center">
            <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className="h-9 px-2 rounded-lg border border-zinc-200 text-xs" />
            <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className="h-9 px-2 rounded-lg border border-zinc-200 text-xs" />
          </div>
        </div>
        <div id="print-production-list" className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b">
              <tr>
                <th className="text-right p-2 text-[10px] font-bold uppercase">التاريخ</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">الشيفت</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">المشغّل</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">كراتين</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">توالف</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {(list ?? []).map((r: any) => {
                const cartons = (r.produced ?? []).reduce((s: number, p: any) => s + Number(p.cartonsTotal || 0), 0);
                const waste = (r.wastages ?? []).reduce((s: number, w: any) => s + Number(w.quantity || 0), 0);
                return (
                  <tr key={r.id} className="border-b">
                    <td className="p-2">{formatDate(r.productionDate)}</td>
                    <td className="p-2 text-xs">{r.shift || '—'}</td>
                    <td className="p-2 text-xs">{r.operatorName || '—'}</td>
                    <td className="p-2 font-bold" data-numeric>{cartons.toLocaleString('en-US')}</td>
                    <td className={cn('p-2', waste > 0 && 'text-amber-600 font-bold')} data-numeric>{waste.toLocaleString('en-US')}</td>
                    <td className="p-2">{r.status === 'POSTED' ? <Badge variant="success" dot>مُرحَّل</Badge> : r.status === 'CANCELLED' ? <Badge variant="danger" dot>ملغي</Badge> : <Badge variant="warning" dot>مسودة</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ═════════════════════════════════════════════
   2) INVENTORY REPORT — بطباعة A4 + Excel
════════════════════════════════════════════ */
function InventoryReport() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');

  const { data: items } = useQuery({
    queryKey: ['inventory-items-report'],
    queryFn: () => api.get('/inventory/items').then((r) => r.data),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (items ?? []).filter((it: any) => {
      if (typeFilter && it.type !== typeFilter) return false;
      if (!q) return true;
      return [it.name, it.sku, it.barcode].filter(Boolean).some((v: string) => v.toLowerCase().includes(q));
    });
  }, [items, search, typeFilter]);

  const totals = useMemo(() => {
    let qty = 0, value = 0;
    filtered.forEach((it: any) => {
      const q = Number(it.totalStock ?? 0);
      const c = Number(it.costPrice ?? it.avgCost ?? 0);
      qty += q;
      value += q * c;
    });
    return { itemsCount: filtered.length, totalQty: qty, totalValue: value };
  }, [filtered]);

  const exportExcel = () => {
    const rows: any[][] = [];
    rows.push([`تقرير المخزون — ${FACTORY_NAME}`]);
    rows.push([`تاريخ التوليد: ${new Date().toLocaleString('ar-JO')}`]);
    rows.push([`الفلاتر: ${search ? `بحث=${search}` : ''} ${typeFilter ? `النوع=${typeFilter}` : ''}`]);
    rows.push([]);
    rows.push(['الاسم', 'SKU', 'التصنيف', 'الوحدة', 'الكمية الحالية', 'سعر الوحدة', 'قيمة المخزون', 'الحد الأدنى', 'الحالة']);
    filtered.forEach((it: any) => {
      const q = Number(it.totalStock ?? 0);
      const c = Number(it.costPrice ?? it.avgCost ?? 0);
      rows.push([
        it.name, it.sku ?? '—', it.type ?? '—', it.unit ?? '—',
        q, c || '—', (q * c).toFixed(2), it.minStock ?? '—',
        it.isLow ? 'منخفض' : q === 0 ? 'نافد' : 'متوفر',
      ]);
    });
    rows.push([]);
    rows.push(['الإجماليات', '', '', '', totals.totalQty, '', totals.totalValue.toFixed(2)]);
    exportToCsv(`inventory-report-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  return (
    <div className="space-y-4">
      <Card className="p-3 flex items-center gap-3 flex-wrap no-print">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالاسم/SKU/الباركود"
            className="w-full h-10 pr-9 pl-3 rounded-lg border border-zinc-200 text-sm" />
        </div>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="h-10 px-3 rounded-lg border border-zinc-200 text-sm">
          <option value="">كل التصنيفات</option>
          <option value="POWDER_BULK">مواد خام</option>
          <option value="PACKAGING">تغليف</option>
          <option value="POWDER_RETAIL">منتج نهائي</option>
          <option value="CONSUMABLE">مستهلكات</option>
        </select>
        <Button variant="ghost" onClick={() => { setSearch(''); setTypeFilter(''); }}>
          <RefreshCw className="h-4 w-4" /> إعادة الفلاتر
        </Button>
        <div className="flex-1" />
        <Button variant="outline" onClick={exportExcel}><FileSpreadsheet className="h-4 w-4" /> تصدير Excel</Button>
        <Button variant="outline" onClick={() => currentReportPrint('print-inventory')}>
          <Printer className="h-4 w-4" /> طباعة التقرير
        </Button>
      </Card>

      <div id="print-inventory">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
          <Stat label="عدد الأصناف" value={totals.itemsCount} />
          <Stat label="إجمالي الكمية" value={totals.totalQty.toFixed(0)} />
          <Stat label="قيمة المخزون" value={totals.totalValue.toFixed(2)} unit="د.أ" state="good" />
        </div>
        <Card className="p-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 border-b">
                <tr>
                  <th className="text-right p-2 text-[10px] font-bold uppercase">الاسم</th>
                  <th className="text-right p-2 text-[10px] font-bold uppercase">SKU</th>
                  <th className="text-right p-2 text-[10px] font-bold uppercase">التصنيف</th>
                  <th className="text-right p-2 text-[10px] font-bold uppercase">الوحدة</th>
                  <th className="text-right p-2 text-[10px] font-bold uppercase">الكمية</th>
                  <th className="text-right p-2 text-[10px] font-bold uppercase">سعر الوحدة</th>
                  <th className="text-right p-2 text-[10px] font-bold uppercase">قيمة المخزون</th>
                  <th className="text-right p-2 text-[10px] font-bold uppercase">الحد الأدنى</th>
                  <th className="text-right p-2 text-[10px] font-bold uppercase">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={9} className="p-8 text-center text-zinc-400">لا توجد أصناف مطابقة</td></tr>
                ) : filtered.map((it: any) => {
                  const q = Number(it.totalStock ?? 0);
                  const c = Number(it.costPrice ?? it.avgCost ?? 0);
                  return (
                    <tr key={it.id} className="border-b">
                      <td className="p-2 font-medium">{it.name}</td>
                      <td className="p-2 font-mono text-xs">{it.sku ?? '—'}</td>
                      <td className="p-2 text-xs">{it.type ?? '—'}</td>
                      <td className="p-2 text-xs">{it.unit ?? '—'}</td>
                      <td className="p-2 font-bold" data-numeric>{q.toLocaleString('en-US')}</td>
                      <td className="p-2" data-numeric>{c > 0 ? c.toFixed(2) : '—'}</td>
                      <td className="p-2 font-bold text-emerald-700" data-numeric>{(q * c).toFixed(2)}</td>
                      <td className="p-2" data-numeric>{it.minStock ?? '—'}</td>
                      <td className="p-2">
                        {q === 0 ? <Badge variant="danger" dot>نافد</Badge>
                          : it.isLow ? <Badge variant="warning" dot>منخفض</Badge>
                          : <Badge variant="success" dot>متوفر</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 border-zinc-300">
                <tr>
                  <td className="p-2 font-bold" colSpan={4}>الإجماليات</td>
                  <td className="p-2 font-bold" data-numeric>{totals.totalQty.toLocaleString('en-US')}</td>
                  <td colSpan={1}></td>
                  <td className="p-2 font-bold text-emerald-700" data-numeric>{totals.totalValue.toFixed(2)} د.أ</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════
   3) ORDERS REPORT — بطباعة A4 + Excel
════════════════════════════════════════════ */
function OrdersReport() {
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<string>('');
  const [orderType, setOrderType] = useState<string>('');

  const { data: orders } = useQuery({
    queryKey: ['orders-report-full', status, orderType],
    queryFn: () => api.get('/orders', { params: { status: status || undefined, orderType: orderType || undefined } }).then((r) => r.data),
  });

  const filtered = useMemo(() => {
    const fromT = new Date(from).getTime();
    const toT = new Date(to).getTime() + 86400000;
    return (orders ?? []).filter((o: any) => {
      const t = new Date(o.orderDate).getTime();
      return t >= fromT && t <= toT;
    });
  }, [orders, from, to]);

  const totals = useMemo(() => {
    let total = 0, paid = 0, balance = 0;
    filtered.forEach((o: any) => {
      total += Number(o.total ?? 0);
      paid += Number(o.paid ?? 0);
      balance += Number(o.balance ?? 0);
    });
    return { ordersCount: filtered.length, total, paid, balance };
  }, [filtered]);

  const exportExcel = () => {
    const rows: any[][] = [];
    rows.push([`تقرير الطلبيات — ${FACTORY_NAME}`]);
    rows.push([`من ${from} إلى ${to} · تاريخ: ${new Date().toLocaleString('ar-JO')}`]);
    rows.push([`الحالة: ${status || 'الكل'} · النوع: ${orderType || 'الكل'}`]);
    rows.push([]);
    rows.push(['رقم الطلب', 'النوع', 'العميل', 'الهاتف', 'المنطقة', 'رقم العقد', 'موقع التسليم', 'رقم الشحنة', 'تاريخ الشحن', 'تاريخ الوصول', 'الكمية بالطن', 'سعر الطن', 'إجمالي البضاعة', 'أجور الشحن', 'الإجمالي النهائي', 'المسدد', 'المتبقي', 'الحالة']);
    filtered.forEach((o: any) => {
      const lines = o.lines ?? [];
      const tonsQty = lines.filter((l: any) => String(l.unit || '').toUpperCase() === 'TON').reduce((s: number, l: any) => s + Number(l.quantity || 0), 0);
      const productsTotal = Number(o.productsTotal ?? 0) || lines.reduce((s: number, l: any) => s + Number(l.lineTotal || 0), 0);
      const shipping = Number(o.shippingCost ?? 0);
      rows.push([
        o.number, o.orderType === 'EXTERNAL' ? 'خارجية' : 'داخلية',
        o.customerName, o.customerPhone ?? '—', o.region ?? '—',
        o.contractNumber ?? '—', o.deliveryLocation ?? '—', o.shipmentTrackingNumber ?? '—',
        o.expectedShippingDate ? formatDate(o.expectedShippingDate) : '—',
        o.expectedArrivalDate ? formatDate(o.expectedArrivalDate) : '—',
        tonsQty > 0 ? tonsQty.toFixed(2) : '—',
        o.tonPrice != null ? Number(o.tonPrice).toFixed(2) : '—',
        productsTotal.toFixed(2), shipping.toFixed(2),
        Number(o.total).toFixed(2), Number(o.paid).toFixed(2), Number(o.balance).toFixed(2),
        o.status,
      ]);
    });
    rows.push([]);
    rows.push(['الإجماليات', '', '', '', '', '', '', '', '', '', '', '', '', '', totals.total.toFixed(2), totals.paid.toFixed(2), totals.balance.toFixed(2), '']);
    exportToCsv(`orders-report-${from}_${to}.csv`, rows);
  };

  return (
    <div className="space-y-4">
      <Card className="p-3 flex items-center gap-3 flex-wrap no-print">
        <label className="text-xs font-bold">من</label>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 px-3 rounded-lg border border-zinc-200 text-sm" />
        <label className="text-xs font-bold">إلى</label>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-10 px-3 rounded-lg border border-zinc-200 text-sm" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 px-3 rounded-lg border border-zinc-200 text-sm">
          <option value="">كل الحالات</option>
          <option value="PAID">مدفوع</option>
          <option value="PARTIAL">جزئي</option>
          <option value="UNPAID">غير مدفوع</option>
          <option value="CANCELLED">ملغي</option>
        </select>
        <select value={orderType} onChange={(e) => setOrderType(e.target.value)} className="h-10 px-3 rounded-lg border border-zinc-200 text-sm">
          <option value="">كل الأنواع</option>
          <option value="INTERNAL">داخلية</option>
          <option value="EXTERNAL">خارجية</option>
        </select>
        <Button variant="ghost" onClick={() => { setStatus(''); setOrderType(''); setFrom(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)); setTo(new Date().toISOString().slice(0, 10)); }}>
          <RefreshCw className="h-4 w-4" /> إعادة
        </Button>
        <div className="flex-1" />
        <Button variant="outline" onClick={exportExcel}><FileSpreadsheet className="h-4 w-4" /> تصدير Excel</Button>
        <Button variant="outline" onClick={() => currentReportPrint('print-orders')}>
          <Printer className="h-4 w-4" /> طباعة التقرير
        </Button>
      </Card>

      <div id="print-orders">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <Stat label="عدد الطلبيات" value={totals.ordersCount} />
          <Stat label="الإجمالي" value={totals.total.toFixed(0)} unit="د.أ" />
          <Stat label="المدفوع" value={totals.paid.toFixed(0)} unit="د.أ" state="good" />
          <Stat label="المتبقي" value={totals.balance.toFixed(0)} unit="د.أ" state={totals.balance > 0 ? 'warning' : 'good'} />
        </div>
        <Card className="p-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1800px]">
              <thead className="bg-zinc-50 border-b">
                <tr>
                  <th className="text-right p-2 text-[10px] font-bold uppercase">رقم</th>
                  <th className="text-right p-2 text-[10px] font-bold uppercase">النوع</th>
                  <th className="text-right p-2 text-[10px] font-bold uppercase">العميل</th>
                  <th className="text-right p-2 text-[10px] font-bold uppercase">رقم العقد</th>
                  <th className="text-right p-2 text-[10px] font-bold uppercase">موقع التسليم</th>
                  <th className="text-right p-2 text-[10px] font-bold uppercase">رقم الشحنة</th>
                  <th className="text-right p-2 text-[10px] font-bold uppercase">تاريخ الشحن</th>
                  <th className="text-right p-2 text-[10px] font-bold uppercase">تاريخ الوصول</th>
                  <th className="text-right p-2 text-[10px] font-bold uppercase bg-sky-50">الكمية بالطن</th>
                  <th className="text-right p-2 text-[10px] font-bold uppercase bg-sky-50">سعر الطن</th>
                  <th className="text-right p-2 text-[10px] font-bold uppercase bg-sky-50">إجمالي البضاعة</th>
                  <th className="text-right p-2 text-[10px] font-bold uppercase bg-sky-50">أجور الشحن</th>
                  <th className="text-right p-2 text-[10px] font-bold uppercase bg-cyan-50">الإجمالي النهائي</th>
                  <th className="text-right p-2 text-[10px] font-bold uppercase bg-emerald-50">المسدد</th>
                  <th className="text-right p-2 text-[10px] font-bold uppercase bg-amber-50">المتبقي</th>
                  <th className="text-right p-2 text-[10px] font-bold uppercase">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={16} className="p-8 text-center text-zinc-400">لا توجد نتائج</td></tr>
                ) : filtered.map((o: any) => {
                  const lines = o.lines ?? [];
                  const tonsQty = lines.filter((l: any) => String(l.unit || '').toUpperCase() === 'TON').reduce((s: number, l: any) => s + Number(l.quantity || 0), 0);
                  const productsTotal = Number(o.productsTotal ?? 0) || lines.reduce((s: number, l: any) => s + Number(l.lineTotal || 0), 0);
                  const shipping = Number(o.shippingCost ?? 0);
                  return (
                    <tr key={o.id} className="border-b">
                      <td className="p-2 font-mono text-xs">{o.number}</td>
                      <td className="p-2">{o.orderType === 'EXTERNAL' ? 'خارجية' : 'داخلية'}</td>
                      <td className="p-2 font-medium">{o.customerName}</td>
                      <td className="p-2 font-mono text-xs">{o.contractNumber || '—'}</td>
                      <td className="p-2">{o.deliveryLocation || '—'}</td>
                      <td className="p-2 font-mono text-xs">{o.shipmentTrackingNumber || '—'}</td>
                      <td className="p-2">{o.expectedShippingDate ? formatDate(o.expectedShippingDate) : '—'}</td>
                      <td className="p-2">{o.expectedArrivalDate ? formatDate(o.expectedArrivalDate) : '—'}</td>
                      <td className="p-2" data-numeric>{tonsQty > 0 ? tonsQty.toFixed(2) : '—'}</td>
                      <td className="p-2" data-numeric>{o.tonPrice != null ? Number(o.tonPrice).toFixed(2) : '—'}</td>
                      <td className="p-2 font-bold" data-numeric>{productsTotal.toFixed(2)}</td>
                      <td className="p-2" data-numeric>{shipping.toFixed(2)}</td>
                      <td className="p-2 font-black" data-numeric>{Number(o.total).toFixed(2)}</td>
                      <td className="p-2 text-emerald-700 font-bold" data-numeric>{Number(o.paid).toFixed(2)}</td>
                      <td className={cn('p-2', Number(o.balance) > 0 ? 'text-amber-600 font-bold' : 'text-zinc-500')} data-numeric>{Number(o.balance).toFixed(2)}</td>
                      <td className="p-2">
                        {o.status === 'PAID' ? <Badge variant="success" dot>مدفوع</Badge>
                          : o.status === 'PARTIAL' ? <Badge variant="warning" dot>جزئي</Badge>
                          : o.status === 'CANCELLED' ? <Badge variant="danger" dot>ملغي</Badge>
                          : <Badge variant="danger" dot>غير مدفوع</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 border-zinc-300">
                <tr>
                  <td className="p-2 font-bold" colSpan={12}>الإجماليات</td>
                  <td className="p-2 font-black" data-numeric>{totals.total.toFixed(2)}</td>
                  <td className="p-2 font-bold text-emerald-700" data-numeric>{totals.paid.toFixed(2)}</td>
                  <td className="p-2 font-bold text-amber-600" data-numeric>{totals.balance.toFixed(2)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════
   4) SALES & COLLECTIONS REPORT
════════════════════════════════════════════ */
function SalesReport() {
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [customerId, setCustomerId] = useState<string>('');
  const [orderType, setOrderType] = useState<string>('');
  const [status, setStatus] = useState<string>('');

  const { data: orders } = useQuery({
    queryKey: ['sales-orders', status, orderType],
    queryFn: () => api.get('/orders', { params: { status: status || undefined, orderType: orderType || undefined } }).then((r) => r.data),
  });
  const { data: customers } = useQuery({
    queryKey: ['customers-report'],
    queryFn: () => api.get('/customers').then((r) => r.data),
  });

  const filtered = useMemo(() => {
    const fromT = new Date(from).getTime();
    const toT = new Date(to).getTime() + 86400000;
    return (orders ?? []).filter((o: any) => {
      const t = new Date(o.orderDate).getTime();
      if (t < fromT || t > toT) return false;
      if (customerId && o.customerId !== customerId) return false;
      return true;
    });
  }, [orders, from, to, customerId]);

  const kpis = useMemo(() => {
    let sales = 0, collected = 0, outstanding = 0;
    let paid = 0, partial = 0, unpaid = 0;
    const byCustomer: Record<string, { name: string; total: number; paid: number }> = {};
    filtered.forEach((o: any) => {
      const total = Number(o.total ?? 0);
      const p = Number(o.paid ?? 0);
      sales += total; collected += p; outstanding += Math.max(0, total - p);
      if (o.status === 'PAID') paid++;
      else if (o.status === 'PARTIAL') partial++;
      else unpaid++;
      const k = o.customerId ?? o.customerName;
      if (!byCustomer[k]) byCustomer[k] = { name: o.customerName, total: 0, paid: 0 };
      byCustomer[k].total += total; byCustomer[k].paid += p;
    });
    const topCustomers = Object.values(byCustomer).sort((a, b) => b.total - a.total).slice(0, 10);
    return {
      sales, collected, outstanding,
      collectionPct: sales > 0 ? (collected / sales) * 100 : 0,
      ordersCount: filtered.length,
      avgOrder: filtered.length > 0 ? sales / filtered.length : 0,
      paid, partial, unpaid,
      topCustomers,
    };
  }, [filtered]);

  const exportExcel = () => {
    const rows: any[][] = [];
    rows.push([`تقرير المبيعات والتحصيلات — ${FACTORY_NAME}`]);
    rows.push([`من ${from} إلى ${to} · ${new Date().toLocaleString('ar-JO')}`]);
    rows.push([]);
    rows.push(['المؤشر', 'القيمة']);
    rows.push(['إجمالي المبيعات', kpis.sales.toFixed(2)]);
    rows.push(['إجمالي المحصّل', kpis.collected.toFixed(2)]);
    rows.push(['المستحق', kpis.outstanding.toFixed(2)]);
    rows.push(['نسبة التحصيل %', kpis.collectionPct.toFixed(1)]);
    rows.push(['عدد الطلبيات', kpis.ordersCount]);
    rows.push(['متوسط قيمة الطلب', kpis.avgOrder.toFixed(2)]);
    rows.push(['مدفوعة كاملاً', kpis.paid]);
    rows.push(['مدفوعة جزئياً', kpis.partial]);
    rows.push(['غير مدفوعة', kpis.unpaid]);
    rows.push([]);
    rows.push(['رقم الطلب', 'التاريخ', 'العميل', 'النوع', 'الإجمالي', 'المدفوع', 'المتبقي', 'الحالة']);
    filtered.forEach((o: any) => rows.push([
      o.number, formatDate(o.orderDate), o.customerName,
      o.orderType === 'EXTERNAL' ? 'خارجية' : 'داخلية',
      Number(o.total).toFixed(2), Number(o.paid).toFixed(2), Number(o.balance).toFixed(2),
      o.status,
    ]));
    exportToCsv(`sales-collections-${from}_${to}.csv`, rows);
  };

  return (
    <div className="space-y-4">
      <Card className="p-3 flex items-center gap-3 flex-wrap no-print">
        <label className="text-xs font-bold">من</label>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 px-3 rounded-lg border border-zinc-200 text-sm" />
        <label className="text-xs font-bold">إلى</label>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-10 px-3 rounded-lg border border-zinc-200 text-sm" />
        <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="h-10 px-3 rounded-lg border border-zinc-200 text-sm">
          <option value="">كل العملاء</option>
          {(customers ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={orderType} onChange={(e) => setOrderType(e.target.value)} className="h-10 px-3 rounded-lg border border-zinc-200 text-sm">
          <option value="">كل الأنواع</option>
          <option value="INTERNAL">داخلية</option>
          <option value="EXTERNAL">خارجية</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 px-3 rounded-lg border border-zinc-200 text-sm">
          <option value="">كل الحالات</option>
          <option value="PAID">مدفوع</option>
          <option value="PARTIAL">جزئي</option>
          <option value="UNPAID">غير مدفوع</option>
        </select>
        <Button variant="ghost" onClick={() => { setCustomerId(''); setOrderType(''); setStatus(''); }}>
          <RefreshCw className="h-4 w-4" /> إعادة
        </Button>
        <div className="flex-1" />
        <Button variant="outline" onClick={exportExcel}><FileSpreadsheet className="h-4 w-4" /> تصدير Excel</Button>
        <Button variant="outline" onClick={() => currentReportPrint('print-sales')}>
          <Printer className="h-4 w-4" /> طباعة التقرير
        </Button>
      </Card>

      <div id="print-sales">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <Stat label="إجمالي المبيعات" value={kpis.sales.toFixed(0)} unit="د.أ" />
          <Stat label="المحصّل" value={kpis.collected.toFixed(0)} unit="د.أ" state="good" />
          <Stat label="المستحق" value={kpis.outstanding.toFixed(0)} unit="د.أ" state={kpis.outstanding > 0 ? 'warning' : 'good'} />
          <Stat label="نسبة التحصيل" value={`${kpis.collectionPct.toFixed(1)}%`} state={kpis.collectionPct > 80 ? 'good' : 'warning'} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <Stat label="عدد الطلبيات" value={kpis.ordersCount} />
          <Stat label="متوسط الطلب" value={kpis.avgOrder.toFixed(2)} unit="د.أ" />
          <Stat label="مدفوعة كاملاً" value={kpis.paid} state="good" />
          <Stat label="مدفوعة جزئياً/غير" value={`${kpis.partial}/${kpis.unpaid}`} />
        </div>

        {kpis.topCustomers.length > 0 && (
          <Card className="p-4 mb-3">
            <h3 className="font-black mb-2">أعلى 10 عملاء بالمبيعات</h3>
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 border-b"><tr>
                <th className="text-right p-2 text-[10px] font-bold uppercase">العميل</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">إجمالي المبيعات</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">المحصّل</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">المستحق</th>
              </tr></thead>
              <tbody>
                {kpis.topCustomers.map((c, i) => (
                  <tr key={i} className="border-b">
                    <td className="p-2 font-medium">{c.name}</td>
                    <td className="p-2 font-bold" data-numeric>{c.total.toFixed(2)}</td>
                    <td className="p-2 text-emerald-700" data-numeric>{c.paid.toFixed(2)}</td>
                    <td className="p-2 text-amber-600" data-numeric>{(c.total - c.paid).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        <Card className="p-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 border-b"><tr>
                <th className="text-right p-2 text-[10px] font-bold uppercase">رقم</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">التاريخ</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">العميل</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">النوع</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">الإجمالي</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">المدفوع</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">المتبقي</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">الحالة</th>
              </tr></thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={8} className="p-8 text-center text-zinc-400">لا توجد نتائج</td></tr>
                ) : filtered.map((o: any) => (
                  <tr key={o.id} className="border-b">
                    <td className="p-2 font-mono text-xs">{o.number}</td>
                    <td className="p-2">{formatDate(o.orderDate)}</td>
                    <td className="p-2 font-medium">{o.customerName}</td>
                    <td className="p-2">{o.orderType === 'EXTERNAL' ? 'خارجية' : 'داخلية'}</td>
                    <td className="p-2 font-bold" data-numeric>{Number(o.total).toFixed(2)}</td>
                    <td className="p-2 text-emerald-700" data-numeric>{Number(o.paid).toFixed(2)}</td>
                    <td className="p-2 text-amber-600" data-numeric>{Number(o.balance).toFixed(2)}</td>
                    <td className="p-2">{o.status}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-zinc-300"><tr>
                <td className="p-2 font-bold" colSpan={4}>الإجماليات</td>
                <td className="p-2 font-bold" data-numeric>{kpis.sales.toFixed(2)}</td>
                <td className="p-2 font-bold text-emerald-700" data-numeric>{kpis.collected.toFixed(2)}</td>
                <td className="p-2 font-bold text-amber-600" data-numeric>{kpis.outstanding.toFixed(2)}</td>
                <td></td>
              </tr></tfoot>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════
   5) PRODUCTION COST & WASTE REPORT
════════════════════════════════════════════ */
function CostWasteReport() {
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [shift, setShift] = useState<string>('');
  const [operator, setOperator] = useState<string>('');

  const { data: list } = useQuery({
    queryKey: ['costwaste-list', from, to],
    queryFn: () => api.get(`/daily-production?from=${from}&to=${to}`).then((r) => r.data),
  });
  const { data: items } = useQuery({
    queryKey: ['items-for-cost'],
    queryFn: () => api.get('/inventory/items').then((r) => r.data),
  });

  const filtered = useMemo(() => {
    return (list ?? []).filter((r: any) => {
      if (shift && r.shift !== shift) return false;
      if (operator && !(r.operatorName ?? '').includes(operator)) return false;
      return true;
    });
  }, [list, shift, operator]);

  // خريطة تكلفة كل صنف من الـ inventory
  const itemCost = useMemo(() => {
    const m: Record<string, number> = {};
    (items ?? []).forEach((it: any) => {
      m[it.id] = Number(it.costPrice ?? it.avgCost ?? 0);
      if (it.name) m[it.name] = m[it.id] || m[it.name] || 0;
    });
    return m;
  }, [items]);

  const rows = useMemo(() => filtered.flatMap((r: any) => {
    const BAG_KG = 25;
    // إجمالي حليب خام بالكغ (تحويل الأكياس)
    let milkKg = 0;
    (r.milkUsage ?? []).forEach((m: any) => {
      const c = Number(m.count || 0);
      const q = Number(m.quantity || 0);
      milkKg += c > 0 ? c * BAG_KG : q;
    });
    const packaging = (r.cartonUsage ?? []).reduce((s: number, x: any) => s + Number(x.quantity || 0), 0)
      + (r.aluminumUsage ?? []).reduce((s: number, x: any) => s + Number(x.quantity || 0), 0);
    const waste = (r.wastages ?? []).reduce((s: number, w: any) => s + Number(w.quantity || 0), 0);
    return (r.produced ?? []).map((p: any) => {
      const producedQty = Number(p.cartonsTotal || 0);
      // تكلفة تقريبية: milkKg × cost حليب + packaging × cost تغليف (fallback على costPrice للـ item)
      const productCost = Number(itemCost[p.itemName] ?? itemCost[p.itemId] ?? 0);
      const totalCost = producedQty * productCost;
      const perUnit = producedQty > 0 ? totalCost / producedQty : 0;
      const wastePct = (producedQty + waste) > 0 ? (waste / (producedQty + waste)) * 100 : 0;
      return {
        id: `${r.id}-${p.itemName}`,
        date: r.productionDate, shift: r.shift, operator: r.operatorName, product: p.itemName,
        producedQty, milkKg, packaging, waste, wastePct, totalCost, perUnit,
        status: r.status,
      };
    });
  }), [filtered, itemCost]);

  const totals = useMemo(() => {
    let produced = 0, milk = 0, pack = 0, waste = 0, cost = 0;
    rows.forEach((r: any) => { produced += r.producedQty; milk += r.milkKg; pack += r.packaging; waste += r.waste; cost += r.totalCost; });
    return { produced, milk, pack, waste, cost, wastePct: (produced + waste) > 0 ? (waste / (produced + waste)) * 100 : 0, perUnit: produced > 0 ? cost / produced : 0 };
  }, [rows]);

  const exportExcel = () => {
    const csv: any[][] = [];
    csv.push([`تقرير تكلفة الإنتاج والهدر — ${FACTORY_NAME}`]);
    csv.push([`من ${from} إلى ${to} · ${new Date().toLocaleString('ar-JO')}`]);
    csv.push([]);
    csv.push(['التاريخ', 'الشيفت', 'المشغّل', 'المنتج', 'الكمية المُنتَجة', 'حليب خام (كغ)', 'تغليف مستهلَك', 'الهدر', 'نسبة الهدر %', 'التكلفة الكلية', 'التكلفة/وحدة', 'الحالة']);
    rows.forEach((r: any) => csv.push([
      formatDate(r.date), r.shift || '—', r.operator || '—', r.product,
      r.producedQty, r.milkKg.toFixed(2), r.packaging.toFixed(2), r.waste,
      r.wastePct.toFixed(2), r.totalCost.toFixed(2), r.perUnit.toFixed(2), r.status,
    ]));
    exportToCsv(`cost-waste-${from}_${to}.csv`, csv);
  };

  return (
    <div className="space-y-4">
      <Card className="p-3 flex items-center gap-3 flex-wrap no-print">
        <label className="text-xs font-bold">من</label>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 px-3 rounded-lg border border-zinc-200 text-sm" />
        <label className="text-xs font-bold">إلى</label>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-10 px-3 rounded-lg border border-zinc-200 text-sm" />
        <select value={shift} onChange={(e) => setShift(e.target.value)} className="h-10 px-3 rounded-lg border border-zinc-200 text-sm">
          <option value="">كل الشيفتات</option>
          <option value="صباحي">صباحي</option>
          <option value="مسائي">مسائي</option>
          <option value="ليلي">ليلي</option>
        </select>
        <input value={operator} onChange={(e) => setOperator(e.target.value)} placeholder="فلترة بمشغّل" className="h-10 px-3 rounded-lg border border-zinc-200 text-sm w-40" />
        <Button variant="ghost" onClick={() => { setShift(''); setOperator(''); }}>
          <RefreshCw className="h-4 w-4" /> إعادة
        </Button>
        <div className="flex-1" />
        <Button variant="outline" onClick={exportExcel}><FileSpreadsheet className="h-4 w-4" /> تصدير Excel</Button>
        <Button variant="outline" onClick={() => currentReportPrint('print-cost')}>
          <Printer className="h-4 w-4" /> طباعة التقرير
        </Button>
      </Card>

      <div id="print-cost">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <Stat label="الإنتاج (وحدة)" value={totals.produced.toFixed(0)} state="good" />
          <Stat label="حليب خام (كغ)" value={totals.milk.toFixed(1)} hint="1 شوال = 25 كغ" />
          <Stat label="التكلفة الكلية" value={totals.cost.toFixed(2)} unit="د.أ" />
          <Stat label="التكلفة/وحدة" value={totals.perUnit.toFixed(3)} unit="د.أ" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
          <Stat label="الهدر" value={totals.waste.toFixed(0)} state={totals.waste > 0 ? 'warning' : 'good'} />
          <Stat label="نسبة الهدر" value={`${totals.wastePct.toFixed(2)}%`} state={totals.wastePct > 5 ? 'danger' : totals.wastePct > 2 ? 'warning' : 'good'} />
          <Stat label="تغليف مستهلَك" value={totals.pack.toFixed(2)} />
        </div>
        <Card className="p-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 border-b"><tr>
                <th className="text-right p-2 text-[10px] font-bold uppercase">التاريخ</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">الشيفت</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">المشغّل</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">المنتج</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">الإنتاج</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">حليب (كغ)</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">تغليف</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">الهدر</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">هدر%</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">التكلفة</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">/وحدة</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">الحالة</th>
              </tr></thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={12} className="p-8 text-center text-zinc-400">لا توجد بيانات</td></tr>
                ) : rows.map((r: any) => (
                  <tr key={r.id} className="border-b">
                    <td className="p-2">{formatDate(r.date)}</td>
                    <td className="p-2 text-xs">{r.shift || '—'}</td>
                    <td className="p-2 text-xs">{r.operator || '—'}</td>
                    <td className="p-2 font-medium">{r.product}</td>
                    <td className="p-2 font-bold" data-numeric>{r.producedQty}</td>
                    <td className="p-2" data-numeric>{r.milkKg.toFixed(1)}</td>
                    <td className="p-2" data-numeric>{r.packaging.toFixed(1)}</td>
                    <td className="p-2 text-amber-600" data-numeric>{r.waste}</td>
                    <td className={cn('p-2 font-bold', r.wastePct > 5 ? 'text-red-600' : r.wastePct > 2 ? 'text-amber-600' : 'text-zinc-500')} data-numeric>{r.wastePct.toFixed(1)}%</td>
                    <td className="p-2 font-bold" data-numeric>{r.totalCost.toFixed(2)}</td>
                    <td className="p-2" data-numeric>{r.perUnit.toFixed(3)}</td>
                    <td className="p-2 text-xs">{r.status}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-zinc-300"><tr>
                <td className="p-2 font-bold" colSpan={4}>الإجماليات</td>
                <td className="p-2 font-bold" data-numeric>{totals.produced.toFixed(0)}</td>
                <td className="p-2 font-bold" data-numeric>{totals.milk.toFixed(1)}</td>
                <td className="p-2 font-bold" data-numeric>{totals.pack.toFixed(1)}</td>
                <td className="p-2 font-bold text-amber-600" data-numeric>{totals.waste.toFixed(0)}</td>
                <td className="p-2 font-bold" data-numeric>{totals.wastePct.toFixed(2)}%</td>
                <td className="p-2 font-bold" data-numeric>{totals.cost.toFixed(2)}</td>
                <td className="p-2 font-bold" data-numeric>{totals.perUnit.toFixed(3)}</td>
                <td></td>
              </tr></tfoot>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════
   6) INVENTORY MOVEMENT REPORT (مخزن واحد)
════════════════════════════════════════════ */
function MovementReport() {
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [itemId, setItemId] = useState<string>('');
  const [type, setType] = useState<string>('');

  const { data: items } = useQuery({
    queryKey: ['items-for-movement'],
    queryFn: () => api.get('/inventory/items').then((r) => r.data),
  });
  const { data: movements } = useQuery({
    queryKey: ['movements', from, to, itemId, type],
    queryFn: () => api.get('/inventory/movements', {
      params: { from, to, itemId: itemId || undefined, type: type || undefined },
    }).then((r) => r.data).catch(() => []),
  });

  const summary = useMemo(() => {
    const list = movements ?? [];
    let received = 0, out = 0;
    const byType: Record<string, number> = {};
    list.forEach((m: any) => {
      const q = Number(m.quantity ?? 0);
      const t = m.type ?? m.reasonCode ?? 'OTHER';
      if (['IN', 'RECEIPT', 'ADD', 'TRANSFER_IN', 'CORRECTION'].includes(t)) received += q;
      else out += q;
      byType[t] = (byType[t] || 0) + q;
    });
    return { count: list.length, received, out, byType };
  }, [movements]);

  const exportExcel = () => {
    const csv: any[][] = [];
    csv.push([`تقرير حركة المخزون — ${FACTORY_NAME} (المخزن الرئيسي)`]);
    csv.push([`من ${from} إلى ${to} · ${new Date().toLocaleString('ar-JO')}`]);
    csv.push([]);
    csv.push(['التاريخ', 'الصنف', 'SKU', 'نوع الحركة', 'الكمية', 'الوحدة', 'المرجع', 'الملاحظات', 'المستخدم']);
    (movements ?? []).forEach((m: any) => csv.push([
      new Date(m.createdAt ?? m.date).toLocaleString('ar-JO'),
      m.item?.name ?? m.itemName ?? '—',
      m.item?.sku ?? '—',
      m.type ?? m.reasonCode ?? '—',
      Number(m.quantity ?? 0),
      m.item?.unit ?? '—',
      m.refType && m.refId ? `${m.refType}:${m.refId.slice(-6)}` : '—',
      m.notes ?? '—',
      m.performedBy?.username ?? m.performedById ?? '—',
    ]));
    exportToCsv(`movement-${from}_${to}.csv`, csv);
  };

  return (
    <div className="space-y-4">
      <Card className="p-3 flex items-center gap-3 flex-wrap no-print">
        <label className="text-xs font-bold">من</label>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 px-3 rounded-lg border border-zinc-200 text-sm" />
        <label className="text-xs font-bold">إلى</label>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-10 px-3 rounded-lg border border-zinc-200 text-sm" />
        <select value={itemId} onChange={(e) => setItemId(e.target.value)} className="h-10 px-3 rounded-lg border border-zinc-200 text-sm">
          <option value="">كل الأصناف</option>
          {(items ?? []).map((it: any) => <option key={it.id} value={it.id}>{it.name}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className="h-10 px-3 rounded-lg border border-zinc-200 text-sm">
          <option value="">كل الأنواع</option>
          <option value="IN">دخول</option>
          <option value="OUT">خروج</option>
          <option value="ADD">إضافة يدوية</option>
          <option value="ADJUST">تعديل</option>
          <option value="CORRECTION">تصحيح</option>
          <option value="COUNT">جرد</option>
          <option value="DAMAGE">هدر/إتلاف</option>
        </select>
        <Button variant="ghost" onClick={() => { setItemId(''); setType(''); }}>
          <RefreshCw className="h-4 w-4" /> إعادة
        </Button>
        <div className="flex-1" />
        <Button variant="outline" onClick={exportExcel}><FileSpreadsheet className="h-4 w-4" /> تصدير Excel</Button>
        <Button variant="outline" onClick={() => currentReportPrint('print-movement')}>
          <Printer className="h-4 w-4" /> طباعة التقرير
        </Button>
      </Card>

      <div id="print-movement">
        <div className="rounded-lg bg-blue-50 border border-blue-100 p-2 text-[11px] text-blue-800 mb-3 no-print">
          📦 هذا التقرير يعكس حركة «المخزن الرئيسي / Main Warehouse» — المصنع يعمل بمخزن واحد فقط.
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
          <Stat label="عدد الحركات" value={summary.count} />
          <Stat label="إجمالي الوارد" value={summary.received.toFixed(0)} state="good" />
          <Stat label="إجمالي الصادر" value={summary.out.toFixed(0)} state={summary.out > 0 ? 'warning' : 'good'} />
        </div>
        <Card className="p-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1100px]">
              <thead className="bg-zinc-50 border-b"><tr>
                <th className="text-right p-2 text-[10px] font-bold uppercase">التاريخ</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">الصنف</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">SKU</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">النوع</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">الكمية</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">الوحدة</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">المرجع</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">ملاحظات</th>
                <th className="text-right p-2 text-[10px] font-bold uppercase">المستخدم</th>
              </tr></thead>
              <tbody>
                {(movements ?? []).length === 0 ? (
                  <tr><td colSpan={9} className="p-8 text-center text-zinc-400">
                    لا توجد حركات — تأكد من نطاق التاريخ أو أن endpoint /inventory/movements مُفعَّل.
                  </td></tr>
                ) : (movements ?? []).map((m: any) => (
                  <tr key={m.id} className="border-b">
                    <td className="p-2 text-xs">{new Date(m.createdAt ?? m.date).toLocaleString('ar-JO')}</td>
                    <td className="p-2 font-medium">{m.item?.name ?? m.itemName ?? '—'}</td>
                    <td className="p-2 font-mono text-xs">{m.item?.sku ?? '—'}</td>
                    <td className="p-2 text-xs">{m.type ?? m.reasonCode ?? '—'}</td>
                    <td className="p-2 font-bold" data-numeric>{Number(m.quantity ?? 0).toFixed(2)}</td>
                    <td className="p-2 text-xs">{m.item?.unit ?? '—'}</td>
                    <td className="p-2 text-xs">{m.refType && m.refId ? `${m.refType}:${m.refId.slice(-6)}` : '—'}</td>
                    <td className="p-2 text-xs text-zinc-500">{m.notes ?? '—'}</td>
                    <td className="p-2 text-xs">{m.performedBy?.username ?? m.performedById ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
