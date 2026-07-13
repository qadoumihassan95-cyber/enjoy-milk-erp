'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Package,
  Plus,
  Search,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Truck,
  Wrench,
  Boxes,
  ArrowUpDown,
  Wallet,
  ArrowLeftRight,
  ClipboardList,
  Download,
  Upload,
  ScanLine,
  Power,
  PowerOff,
  Filter as FilterIcon,
  X,
} from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import { AppShell } from '@/components/app-shell';
import { Card, CardHeader, CardTitle, CardContent, Button, Stat, Badge, TableSkeleton, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/api';
import { formatNumber, formatDate, cn } from '@/lib/utils';

const SAVED_FILTERS_KEY = 'inv-saved-filters-v1';
const PAGE_SIZE = 50;

const TYPE_LABEL: Record<string, string> = {
  POWDER_BULK: 'بودرة بالجملة',
  PACKAGING: 'مواد تغليف',
  POWDER_RETAIL: 'منتج نهائي',
  CONSUMABLE: 'مستهلكات',
};

function itemStatusBadge(status?: string) {
  switch (status) {
    case 'OUT': return <Badge variant="danger" dot>منتهي</Badge>;
    case 'CRITICAL': return <Badge variant="danger" dot>حرج</Badge>;
    case 'LOW': return <Badge variant="warning" dot>منخفض</Badge>;
    default: return <Badge variant="success" dot>متوفر</Badge>;
  }
}

async function downloadCsv(path: string, filename: string) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  const baseURL = (api.defaults.baseURL || '').replace(/\/$/, '');
  const res = await fetch(`${baseURL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('تعذّر التصدير');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

interface SavedFilter { name: string; search: string; typeFilter: string; }

export default function InventoryDashboardPage() {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [barcode, setBarcode] = useState('');
  const [showExport, setShowExport] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);

  // تحميل الفلاتر المحفوظة من localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(SAVED_FILTERS_KEY);
      if (raw) setSavedFilters(JSON.parse(raw));
    } catch { /* noop */ }
  }, []);

  const persistFilters = (list: SavedFilter[]) => {
    setSavedFilters(list);
    try { localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(list)); } catch { /* noop */ }
  };

  // reset selection when filters change
  useEffect(() => { setSelectedIds(new Set()); setPage(0); }, [search, typeFilter]);

  const { data: dashboard, isLoading: dashLoading } = useQuery({
    queryKey: ['inv-dashboard'],
    queryFn: () => api.get('/inventory/dashboard').then((r) => r.data),
    refetchInterval: 60_000,
  });

  const { data: page_, isLoading: itemsLoading } = useQuery({
    queryKey: ['inv-items-paginated', search, typeFilter, page],
    queryFn: () => api.get('/inventory/items/paginated', {
      params: {
        search: search || undefined,
        type: typeFilter || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      },
    }).then((r) => r.data),
  });
  const items = page_?.items;
  const total = page_?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Bulk mutations
  const bulk = useMutation({
    mutationFn: ({ op, ids }: { op: string; ids: string[] }) =>
      api.post(`/inventory/items/${op}`, { ids }).then((r) => r.data),
    onSuccess: (res, vars) => {
      toast.success(`تم ${vars.op === 'bulk-activate' ? 'تفعيل' : 'تعطيل'} ${res.updated} صنف`);
      setSelectedIds(new Set());
      qc.invalidateQueries({ queryKey: ['inv-items-paginated'] });
      qc.invalidateQueries({ queryKey: ['inv-dashboard'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'تعذّرت العملية'),
  });

  // Barcode scan
  const scanBarcode = async (code: string) => {
    if (!code.trim()) return;
    try {
      const res = await api.get(`/inventory/items/barcode/${encodeURIComponent(code.trim())}`);
      if (res.data?.id) {
        router.push(`/inventory/items/${res.data.id}`);
      } else {
        toast.error('لم يُعثر على صنف بهذا الباركود');
      }
    } catch {
      toast.error('تعذّر البحث بالباركود');
    } finally {
      setBarcode('');
    }
  };

  const kpi = dashboard?.kpi ?? {};
  const trend = dashboard?.trend ?? [];
  const valueByType = dashboard?.valueByType ?? {};
  const valueByTypeChart = Object.entries(valueByType).map(([k, v]: any) => ({
    type: TYPE_LABEL[k] ?? k,
    value: Number(v),
  }));

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-zinc-900 text-white flex items-center justify-center">
              <Boxes className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-black tracking-tight">المخزون</h1>
              <p className="text-sm text-zinc-500 mt-0.5">لوحة تحكم كاملة — قيمة، تنبيهات، حركة، وأداء المواد</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" onClick={() => router.push('/inventory/transfers')}>
              <ArrowLeftRight className="h-4 w-4" /> تحويلات
            </Button>
            <Button variant="outline" onClick={() => router.push('/inventory/counts')}>
              <ClipboardList className="h-4 w-4" /> الجرد
            </Button>
            <div className="relative">
              <Button variant="outline" onClick={() => setShowExport((v) => !v)}>
                <Download className="h-4 w-4" /> تصدير
              </Button>
              {showExport && (
                <div className="absolute left-0 mt-1 w-56 rounded-lg border border-zinc-200 bg-white shadow-lg z-20 py-1"
                  onMouseLeave={() => setShowExport(false)}>
                  {[
                    { path: '/inventory/reports/stock-value.csv', file: 'stock-value.csv', label: 'قيمة المخزون' },
                    { path: '/inventory/reports/movement.csv', file: 'movement.csv', label: 'حركة المخزون (30 يوم)' },
                    { path: '/inventory/reports/low-stock.csv', file: 'low-stock.csv', label: 'مواد منخفضة' },
                    { path: '/inventory/reports/dead-stock.csv', file: 'dead-stock.csv', label: 'مواد راكدة' },
                  ].map((e) => (
                    <button key={e.path} onClick={() => { downloadCsv(e.path, e.file); setShowExport(false); }}
                      className="w-full text-right px-3 py-2 text-sm hover:bg-zinc-50">
                      {e.label} <span className="text-[10px] text-zinc-400">CSV</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Button variant="outline" onClick={() => router.push('/inventory/import')}>
              <Upload className="h-4 w-4" /> استيراد
            </Button>
            <Button variant="outline" onClick={() => router.push('/inventory/adjust')}>
              <Wrench className="h-4 w-4" /> تعديل
            </Button>
            <Button onClick={() => router.push('/inventory/receive')}>
              <Truck className="h-4 w-4" /> إضافة مخزون
            </Button>
          </div>
        </header>

        {/* Barcode scan bar (يعمل مع الماسحات USB — تسجيل Enter بعد المسح) */}
        <div className="rounded-xl bg-white border border-zinc-200 p-3 flex items-center gap-3">
          <ScanLine className="h-5 w-5 text-zinc-500 shrink-0" />
          <input
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); scanBarcode(barcode); } }}
            placeholder="امسح الباركود أو أدخله ثم Enter — يفتح الصنف مباشرة"
            className="flex-1 h-9 px-3 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
            autoFocus
          />
          {barcode && (
            <button onClick={() => setBarcode('')} className="text-zinc-400 hover:text-zinc-700">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* KPIs */}
        <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Stat label="قيمة المخزون" value={formatNumber(kpi.totalValue ?? 0, 0)} unit="د.أ" state="good" />
          <Stat label="عدد الأصناف" value={formatNumber(kpi.itemsCount ?? 0, 0)} />
          <Stat label="إجمالي الكمية" value={formatNumber(kpi.totalStockQty ?? 0, 0)} />
          <Stat label="منخفض المخزون" value={formatNumber(kpi.lowStock ?? 0, 0)} state={(kpi.lowStock ?? 0) > 0 ? 'warning' : 'good'} />
          <Stat label="حرج" value={formatNumber(kpi.critical ?? 0, 0)} state={(kpi.critical ?? 0) > 0 ? 'danger' : 'good'} />
          <Stat label="منتهي" value={formatNumber(kpi.outOfStock ?? 0, 0)} state={(kpi.outOfStock ?? 0) > 0 ? 'danger' : 'good'} />
        </section>

        {/* Charts */}
        <div className="grid lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Wallet className="h-4 w-4" /> قيمة المخزون حسب التصنيف</CardTitle>
            </CardHeader>
            <CardContent>
              {valueByTypeChart.length === 0 ? (
                <p className="text-sm text-zinc-400 text-center py-8">لا توجد بيانات كافية</p>
              ) : (
                <div style={{ width: '100%', height: 260 }} dir="ltr">
                  <ResponsiveContainer>
                    <BarChart data={valueByTypeChart}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                      <XAxis dataKey="type" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="value" name="القيمة" fill="#18181b" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ArrowUpDown className="h-4 w-4" /> حركة المخزون (آخر ١٤ يوم)</CardTitle>
            </CardHeader>
            <CardContent>
              {trend.length === 0 ? (
                <p className="text-sm text-zinc-400 text-center py-8">لا توجد حركة</p>
              ) : (
                <div style={{ width: '100%', height: 260 }} dir="ltr">
                  <ResponsiveContainer>
                    <LineChart data={trend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="in" name="داخل" stroke="#059669" strokeWidth={2} />
                      <Line type="monotone" dataKey="out" name="خارج" stroke="#dc2626" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Alerts + top moving + dead stock */}
        <div className="grid lg:grid-cols-3 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" /> تنبيهات المخزون</CardTitle>
            </CardHeader>
            <CardContent>
              {(!dashboard?.lowStockItems || dashboard.lowStockItems.length === 0) ? (
                <p className="text-sm text-emerald-600 text-center py-4">✓ كل الأصناف بحالة جيدة</p>
              ) : (
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {dashboard.lowStockItems.map((it: any) => (
                    <Link key={it.id} href={`/inventory/items/${it.id}`} className="flex items-center justify-between p-2 rounded-md border border-zinc-100 hover:bg-zinc-50">
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{it.name}</div>
                        <div className="text-[11px] text-zinc-500 font-mono">{it.sku}</div>
                      </div>
                      <div className="text-left shrink-0">
                        {itemStatusBadge(it.status)}
                        <div className="text-[11px] mt-0.5 text-zinc-500" data-numeric>{formatNumber(it.stock, 0)} {it.unit}</div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-emerald-600" /> أكثر المواد حركة</CardTitle>
            </CardHeader>
            <CardContent>
              {(!dashboard?.topMoving || dashboard.topMoving.length === 0) ? (
                <p className="text-sm text-zinc-400 text-center py-4">لا توجد بيانات</p>
              ) : (
                <div className="space-y-1.5">
                  {dashboard.topMoving.map((it: any) => (
                    <Link key={it.id} href={`/inventory/items/${it.id}`} className="flex items-center justify-between p-2 rounded-md border border-zinc-100 hover:bg-zinc-50">
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{it.name}</div>
                        <div className="text-[11px] text-zinc-500 font-mono">{it.sku}</div>
                      </div>
                      <div className="text-sm font-bold text-emerald-700" data-numeric>{formatNumber(it.qty, 0)}</div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><TrendingDown className="h-4 w-4 text-zinc-500" /> مواد راكدة</CardTitle>
            </CardHeader>
            <CardContent>
              {(!dashboard?.deadStock || dashboard.deadStock.length === 0) ? (
                <p className="text-sm text-zinc-400 text-center py-4">لا توجد مواد راكدة</p>
              ) : (
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {dashboard.deadStock.map((it: any) => (
                    <Link key={it.id} href={`/inventory/items/${it.id}`} className="flex items-center justify-between p-2 rounded-md border border-zinc-100 hover:bg-zinc-50">
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{it.name}</div>
                        <div className="text-[11px] text-zinc-500 font-mono">{it.sku}</div>
                      </div>
                      <Badge variant="default">راكد</Badge>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recent activity */}
        <div className="grid lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Truck className="h-4 w-4" /> آخر عمليات الاستلام</CardTitle>
            </CardHeader>
            <CardContent>
              {(!dashboard?.recentReceipts || dashboard.recentReceipts.length === 0) ? (
                <p className="text-sm text-zinc-400 text-center py-4">لا يوجد استلامات</p>
              ) : (
                <div className="space-y-1.5">
                  {dashboard.recentReceipts.map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between p-2 rounded-md border border-zinc-100">
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{r.item}</div>
                        <div className="text-[11px] text-zinc-500">
                          {r.source}{r.supplier ? ` · ${r.supplier}` : ''} · {formatDate(r.createdAt)}
                        </div>
                      </div>
                      <div className="text-sm font-bold text-emerald-700" data-numeric>+{formatNumber(r.quantity, 0)}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Wrench className="h-4 w-4" /> آخر التعديلات</CardTitle>
            </CardHeader>
            <CardContent>
              {(!dashboard?.recentAdjustments || dashboard.recentAdjustments.length === 0) ? (
                <p className="text-sm text-zinc-400 text-center py-4">لا يوجد تعديلات</p>
              ) : (
                <div className="space-y-1.5">
                  {dashboard.recentAdjustments.map((a: any) => (
                    <div key={a.id} className="flex items-center justify-between p-2 rounded-md border border-zinc-100">
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{a.item}</div>
                        <div className="text-[11px] text-zinc-500">{a.type} · {a.reason} · {formatDate(a.createdAt)}</div>
                      </div>
                      <div className={cn('text-sm font-bold', Number(a.quantity) >= 0 ? 'text-emerald-700' : 'text-red-600')} data-numeric>
                        {Number(a.quantity) >= 0 ? '+' : ''}{formatNumber(a.quantity, 1)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Items table */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="flex items-center gap-2">
                <Package className="h-4 w-4" /> قائمة الأصناف
                <span className="text-xs text-zinc-500 font-normal" data-numeric>({formatNumber(total, 0)})</span>
              </CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                  <input
                    type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                    placeholder="بحث بالاسم/SKU/باركود..."
                    className="h-9 pr-9 pl-3 rounded-lg border border-zinc-200 text-sm w-64"
                  />
                </div>
                <select
                  value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
                  className="h-9 px-2 rounded-lg border border-zinc-200 text-sm"
                >
                  <option value="">كل الأنواع</option>
                  {Object.entries(TYPE_LABEL).map(([k, l]) => (
                    <option key={k} value={k}>{l}</option>
                  ))}
                </select>
                {/* Saved filters */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      if (!search && !typeFilter) return toast.error('اختر فلاتر أولاً');
                      const name = prompt('اسم للفلتر المحفوظ:');
                      if (!name?.trim()) return;
                      persistFilters([...savedFilters, { name: name.trim(), search, typeFilter }]);
                      toast.success('تم حفظ الفلتر');
                    }}
                    className="h-9 px-2 rounded-lg border border-zinc-200 text-xs font-bold hover:bg-zinc-50 inline-flex items-center gap-1"
                    title="حفظ الفلاتر الحالية"
                  >
                    <FilterIcon className="h-3.5 w-3.5" /> حفظ
                  </button>
                  {savedFilters.length > 0 && (
                    <select
                      onChange={(e) => {
                        const v = e.target.value;
                        if (!v) return;
                        if (v === '__clear__') { setSearch(''); setTypeFilter(''); return; }
                        const f = savedFilters.find((sf) => sf.name === v);
                        if (f) { setSearch(f.search); setTypeFilter(f.typeFilter); }
                        e.target.value = '';
                      }}
                      className="h-9 px-2 rounded-lg border border-zinc-200 text-xs"
                      defaultValue=""
                    >
                      <option value="">فلاتر محفوظة</option>
                      <option value="__clear__">— مسح الفلاتر —</option>
                      {savedFilters.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
                    </select>
                  )}
                </div>
              </div>
            </div>
            {/* Bulk action bar */}
            {selectedIds.size > 0 && (
              <div className="mt-3 rounded-lg bg-zinc-900 text-white p-3 flex items-center justify-between flex-wrap gap-2">
                <div className="text-sm">
                  <b data-numeric>{selectedIds.size}</b> صنف محدد
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700"
                    onClick={() => bulk.mutate({ op: 'bulk-activate', ids: Array.from(selectedIds) })}
                    loading={bulk.isPending}>
                    <Power className="h-3 w-3" /> تفعيل
                  </Button>
                  <Button size="sm" variant="outline" className="bg-transparent text-white border-white/30 hover:bg-white/10"
                    onClick={() => {
                      if (!confirm(`تعطيل ${selectedIds.size} صنف؟`)) return;
                      bulk.mutate({ op: 'bulk-deactivate', ids: Array.from(selectedIds) });
                    }}>
                    <PowerOff className="h-3 w-3" /> تعطيل
                  </Button>
                  <Button size="sm" variant="ghost" className="text-white hover:bg-white/10"
                    onClick={() => setSelectedIds(new Set())}>
                    <X className="h-3 w-3" /> إلغاء التحديد
                  </Button>
                </div>
              </div>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {itemsLoading ? (
              <TableSkeleton rows={8} cols={7} />
            ) : !items || items.length === 0 ? (
              <div className="p-12 text-center">
                <Package className="h-12 w-12 mx-auto text-zinc-300 mb-3" />
                <p className="text-zinc-500">لا توجد أصناف مطابقة</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 border-b">
                    <tr>
                      <th className="p-3 w-8">
                        <input
                          type="checkbox"
                          checked={items.every((it: any) => selectedIds.has(it.id))}
                          onChange={(e) => {
                            const next = new Set(selectedIds);
                            if (e.target.checked) items.forEach((it: any) => next.add(it.id));
                            else items.forEach((it: any) => next.delete(it.id));
                            setSelectedIds(next);
                          }}
                        />
                      </th>
                      <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">SKU</th>
                      <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">الاسم</th>
                      <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">النوع</th>
                      <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">الكمية</th>
                      <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">التكلفة</th>
                      <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">القيمة</th>
                      <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it: any) => {
                      const stock = Number(it.totalStock ?? 0);
                      const cost = Number(it.avgCost ?? it.costPrice ?? 0);
                      const value = stock * cost;
                      const status = stock <= 0 ? 'OUT'
                        : it.safetyStock != null && stock < Number(it.safetyStock) ? 'CRITICAL'
                        : it.isLow ? 'LOW' : 'OK';
                      const checked = selectedIds.has(it.id);
                      return (
                        <tr key={it.id} className="border-b border-zinc-100 hover:bg-zinc-50">
                          <td className="p-3 w-8" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                const next = new Set(selectedIds);
                                checked ? next.delete(it.id) : next.add(it.id);
                                setSelectedIds(next);
                              }}
                            />
                          </td>
                          <td className="p-3 font-mono text-xs cursor-pointer" onClick={() => router.push(`/inventory/items/${it.id}`)}>{it.sku}</td>
                          <td className="p-3 font-medium cursor-pointer" onClick={() => router.push(`/inventory/items/${it.id}`)}>{it.name}</td>
                          <td className="p-3 text-zinc-600 text-xs cursor-pointer" onClick={() => router.push(`/inventory/items/${it.id}`)}>{TYPE_LABEL[it.type] ?? it.type}</td>
                          <td className="p-3 font-bold cursor-pointer" data-numeric onClick={() => router.push(`/inventory/items/${it.id}`)}>{formatNumber(stock, 0)} {it.unit}</td>
                          <td className="p-3 text-zinc-600 cursor-pointer" data-numeric onClick={() => router.push(`/inventory/items/${it.id}`)}>{cost > 0 ? formatNumber(cost, 2) : '—'}</td>
                          <td className="p-3 font-bold text-emerald-700 cursor-pointer" data-numeric onClick={() => router.push(`/inventory/items/${it.id}`)}>{formatNumber(value, 0)}</td>
                          <td className="p-3 cursor-pointer" onClick={() => router.push(`/inventory/items/${it.id}`)}>{itemStatusBadge(status)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {/* Pagination */}
            {total > PAGE_SIZE && (
              <div className="p-3 border-t border-zinc-100 flex items-center justify-between text-sm">
                <div className="text-zinc-500">
                  عرض <b>{page * PAGE_SIZE + 1}</b> - <b>{Math.min((page + 1) * PAGE_SIZE, total)}</b> من <b data-numeric>{formatNumber(total, 0)}</b>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>السابق</Button>
                  <div className="px-3 py-1 text-xs font-bold">
                    {page + 1} / {totalPages}
                  </div>
                  <Button size="sm" variant="outline" disabled={!page_?.hasMore} onClick={() => setPage(page + 1)}>التالي</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
