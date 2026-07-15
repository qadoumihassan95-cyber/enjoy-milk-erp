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
  const [showNewItem, setShowNewItem] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);

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
      {/* DESKTOP (≥ md) — UNCHANGED. Wrapped in hidden md:block. */}
      <div className="hidden md:block max-w-6xl mx-auto p-4 md:p-6 space-y-6">
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
            {/* ─── تحويلات المخزون أُلغيت: المصنع يعمل بمخزن واحد فقط ─── */}
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
                    { path: '/inventory/reports/stock-value.xlsx', file: 'stock-value.xlsx', label: 'قيمة المخزون' },
                    { path: '/inventory/reports/movement.xlsx',   file: 'movement.xlsx',    label: 'حركة المخزون (30 يوم)' },
                    { path: '/inventory/reports/low-stock.xlsx',  file: 'low-stock.xlsx',   label: 'مواد منخفضة' },
                    { path: '/inventory/reports/dead-stock.xlsx', file: 'dead-stock.xlsx',  label: 'مواد راكدة' },
                  ].map((e) => (
                    <button key={e.path} onClick={() => { downloadCsv(e.path, e.file); setShowExport(false); }}
                      className="w-full text-right px-3 py-2 text-sm hover:bg-zinc-50">
                      {e.label} <span className="text-[10px] text-zinc-400">Excel</span>
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
            <Button variant="outline" onClick={() => router.push('/inventory/receive')}>
              <Truck className="h-4 w-4" /> إضافة كمية للمخزون
            </Button>
            <Button
              onClick={() => setShowNewItem(true)}
              className="bg-emerald-600 hover:bg-emerald-700 border-emerald-600"
              title="أنشئ صنفاً جديداً غير موجود بعد في المخزون"
            >
              <Plus className="h-4 w-4" /> إضافة صنف جديد
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
                      <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">إجراء</th>
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
                          <td className="p-3" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => setEditingItem({ ...it, currentStock: stock })}
                              className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 font-bold inline-flex items-center gap-1"
                              title="تعديل الصنف"
                            >
                              <Wrench className="h-3 w-3" /> تعديل
                            </button>
                          </td>
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

      {/* ═══════════════════════════════════════════════
          MOBILE (< md) — new professional layout.
          Preserves every desktop capability.
      ═══════════════════════════════════════════════ */}
      <MobileInventory
        kpi={kpi}
        dashboard={dashboard}
        items={items}
        total={total}
        page={page}
        totalPages={totalPages}
        hasMore={!!page_?.hasMore}
        onPage={setPage}
        search={search}
        onSearch={setSearch}
        typeFilter={typeFilter}
        onTypeFilter={setTypeFilter}
        barcode={barcode}
        onBarcode={setBarcode}
        onScan={scanBarcode}
        selectedIds={selectedIds}
        onSelected={setSelectedIds}
        onBulkActivate={() => bulk.mutate({ op: 'bulk-activate', ids: Array.from(selectedIds) })}
        onBulkDeactivate={() => {
          if (!confirm(`تعطيل ${selectedIds.size} صنف؟`)) return;
          bulk.mutate({ op: 'bulk-deactivate', ids: Array.from(selectedIds) });
        }}
        bulkPending={bulk.isPending}
        savedFilters={savedFilters}
        onSaveFilter={() => {
          if (!search && !typeFilter) return toast.error('اختر فلاتر أولاً');
          const name = prompt('اسم للفلتر المحفوظ:');
          if (!name?.trim()) return;
          persistFilters([...savedFilters, { name: name.trim(), search, typeFilter }]);
          toast.success('تم حفظ الفلتر');
        }}
        onApplySaved={(f: SavedFilter) => { setSearch(f.search); setTypeFilter(f.typeFilter); }}
        onNewItem={() => setShowNewItem(true)}
        onEditItem={(it: any, stock: number) => setEditingItem({ ...it, currentStock: stock })}
        router={router}
      />

      {/* ─── Modal: إضافة صنف جديد (منفصل عن "إضافة كمية للمخزون") ─── */}
      {showNewItem && (
        <NewItemModal
          onClose={() => setShowNewItem(false)}
          onCreated={() => {
            toast.success('تم إضافة الصنف بنجاح');
            qc.invalidateQueries({ queryKey: ['inv-dashboard'] });
            qc.invalidateQueries({ queryKey: ['inv-items'] });
            qc.invalidateQueries({ queryKey: ['items-all'] });
            qc.invalidateQueries({ queryKey: ['items-active'] });
            setShowNewItem(false);
          }}
        />
      )}

      {/* ─── Modal: تعديل صنف موجود ─── */}
      {editingItem && (
        <EditItemModal
          item={editingItem}
          onClose={() => setEditingItem(null)}
          onSaved={() => {
            toast.success('تم تعديل الصنف');
            qc.invalidateQueries({ queryKey: ['inv-dashboard'] });
            qc.invalidateQueries({ queryKey: ['inv-items'] });
            setEditingItem(null);
          }}
        />
      )}
    </AppShell>
  );
}

/* ═════════════════════════════════════════════════════════════════
   MobileInventory — mobile view (< md).
   All desktop features preserved (barcode scan, search, type filter,
   saved filters, bulk activate/deactivate, alerts/top-moving/dead
   accordions, item cards with edit + detail links, export via Actions
   sheet, receive/adjust/counts/import navigation, pagination).
════════════════════════════════════════════════════════════════════ */
function MobileInventory({
  kpi, dashboard, items, total, page, totalPages, hasMore, onPage,
  search, onSearch, typeFilter, onTypeFilter,
  barcode, onBarcode, onScan,
  selectedIds, onSelected, onBulkActivate, onBulkDeactivate, bulkPending,
  savedFilters, onSaveFilter, onApplySaved,
  onNewItem, onEditItem, router,
}: any) {
  const [showFilter, setShowFilter] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [openSection, setOpenSection] = useState<string | null>(null);

  const activeFilterCount = (typeFilter ? 1 : 0);
  const lowStockCount = kpi.lowStock ?? 0;
  const critCount = kpi.critical ?? 0;
  const outCount = kpi.outOfStock ?? 0;

  const closeSheets = () => { setShowFilter(false); setShowActions(false); setShowExport(false); };

  return (
    <div className="md:hidden print:hidden" dir="rtl">
      {/* Sticky header */}
      <div className="sticky top-0 z-20 bg-zinc-50/95 backdrop-blur border-b border-zinc-200 px-3 pt-3 pb-2">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-zinc-900 text-white flex items-center justify-center shrink-0">
              <Boxes className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-black tracking-tight leading-tight">المخزون</h1>
              <p className="text-[10px] text-zinc-500">
                {formatNumber(total, 0)} صنف{lowStockCount > 0 ? ` · ${lowStockCount} منخفضة` : ''}
              </p>
            </div>
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setShowActions(true)}
              aria-label="إجراءات المخزون"
              className="w-10 h-10 rounded-full bg-white border border-zinc-200 text-zinc-700 flex items-center justify-center active:scale-95 transition-transform"
            >
              <ArrowUpDown className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onNewItem}
              aria-label="إضافة صنف جديد"
              className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center active:scale-95 transition-transform shadow-md"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Scan bar — always visible for warehouse workflow */}
        <div className="flex items-center gap-2 bg-white border border-zinc-200 rounded-xl px-2.5 h-10 mb-2">
          <ScanLine className="h-4 w-4 text-emerald-600 shrink-0" />
          <input
            value={barcode}
            onChange={(e) => onBarcode(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onScan(barcode); } }}
            placeholder="امسح باركود أو أدخله…"
            className="flex-1 h-full text-sm bg-transparent focus:outline-none placeholder:text-zinc-400 min-w-0"
          />
          {barcode ? (
            <button onClick={() => onBarcode('')} aria-label="مسح" className="text-zinc-400 shrink-0">
              <X className="h-4 w-4" />
            </button>
          ) : (
            <span className="text-[10px] bg-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded shrink-0">Enter</span>
          )}
        </div>

        {/* Search + filter */}
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="بحث بالاسم / SKU / باركود…"
              className="w-full h-10 pr-9 pl-3 rounded-xl border border-zinc-200 bg-white text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowFilter(true)}
            aria-label={`فلترة${activeFilterCount > 0 ? ` (${activeFilterCount} مفعّلة)` : ''}`}
            className={cn(
              'relative h-10 min-w-[44px] px-3 rounded-xl flex items-center justify-center gap-1.5 text-sm font-bold active:scale-95 transition-transform',
              activeFilterCount > 0
                ? 'bg-zinc-900 text-white'
                : 'bg-white border border-zinc-200 text-zinc-700',
            )}
          >
            <FilterIcon className="h-4 w-4" />
            <span>فلترة</span>
            {activeFilterCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-amber-500 text-white text-[10px] font-black flex items-center justify-center px-1">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="px-3 pt-3 pb-24 space-y-3">
        {/* KPI ribbon — 6 metrics */}
        <div
          className="flex gap-2 overflow-x-auto -mx-3 px-3 pb-1 [&::-webkit-scrollbar]:hidden"
          style={{ scrollbarWidth: 'none' }}
        >
          <InvKpi label="قيمة المخزون" value={formatNumber(kpi.totalValue ?? 0, 0)} tone="good" unit="د.أ" />
          <InvKpi label="عدد الأصناف" value={formatNumber(kpi.itemsCount ?? 0, 0)} />
          <InvKpi label="إجمالي الكمية" value={formatNumber(kpi.totalStockQty ?? 0, 0)} />
          <InvKpi label="منخفض" value={formatNumber(lowStockCount, 0)} tone={lowStockCount > 0 ? 'warn' : 'neutral'} />
          <InvKpi label="حرج" value={formatNumber(critCount, 0)} tone={critCount > 0 ? 'danger' : 'neutral'} />
          <InvKpi label="منتهي" value={formatNumber(outCount, 0)} tone={outCount > 0 ? 'danger' : 'neutral'} />
        </div>

        {/* Insight accordions */}
        <InvSection
          icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
          title="تنبيهات المخزون"
          count={dashboard?.lowStockItems?.length ?? 0}
          open={openSection === 'alerts'}
          onToggle={() => setOpenSection(openSection === 'alerts' ? null : 'alerts')}
        >
          {(!dashboard?.lowStockItems || dashboard.lowStockItems.length === 0) ? (
            <p className="text-sm text-emerald-600 text-center py-4">✓ كل الأصناف بحالة جيدة</p>
          ) : (
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {dashboard.lowStockItems.map((it: any) => (
                <Link key={it.id} href={`/inventory/items/${it.id}`} className="flex items-center justify-between p-2 rounded-lg border border-zinc-100 active:bg-zinc-50 min-h-[44px]">
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{it.name}</div>
                    <div className="text-[10px] text-zinc-500 font-mono">{it.sku}</div>
                  </div>
                  <div className="text-left shrink-0 pl-2">
                    {itemStatusBadge(it.status)}
                    <div className="text-[10px] mt-0.5 text-zinc-500" data-numeric>{formatNumber(it.stock, 0)} {it.unit}</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </InvSection>

        <InvSection
          icon={<TrendingUp className="h-4 w-4 text-emerald-600" />}
          title="أكثر المواد حركة"
          count={dashboard?.topMoving?.length ?? 0}
          open={openSection === 'top'}
          onToggle={() => setOpenSection(openSection === 'top' ? null : 'top')}
        >
          {(!dashboard?.topMoving || dashboard.topMoving.length === 0) ? (
            <p className="text-sm text-zinc-400 text-center py-3">لا توجد بيانات</p>
          ) : (
            <div className="space-y-1">
              {dashboard.topMoving.map((it: any) => (
                <Link key={it.id} href={`/inventory/items/${it.id}`} className="flex items-center justify-between p-2 rounded-lg border border-zinc-100 active:bg-zinc-50 min-h-[44px]">
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{it.name}</div>
                    <div className="text-[10px] text-zinc-500 font-mono">{it.sku}</div>
                  </div>
                  <div className="text-sm font-bold text-emerald-700" data-numeric>{formatNumber(it.qty, 0)}</div>
                </Link>
              ))}
            </div>
          )}
        </InvSection>

        <InvSection
          icon={<TrendingDown className="h-4 w-4 text-zinc-500" />}
          title="مواد راكدة"
          count={dashboard?.deadStock?.length ?? 0}
          open={openSection === 'dead'}
          onToggle={() => setOpenSection(openSection === 'dead' ? null : 'dead')}
        >
          {(!dashboard?.deadStock || dashboard.deadStock.length === 0) ? (
            <p className="text-sm text-zinc-400 text-center py-3">لا توجد مواد راكدة</p>
          ) : (
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {dashboard.deadStock.map((it: any) => (
                <Link key={it.id} href={`/inventory/items/${it.id}`} className="flex items-center justify-between p-2 rounded-lg border border-zinc-100 active:bg-zinc-50 min-h-[44px]">
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{it.name}</div>
                    <div className="text-[10px] text-zinc-500 font-mono">{it.sku}</div>
                  </div>
                  <Badge variant="default">راكد</Badge>
                </Link>
              ))}
            </div>
          )}
        </InvSection>

        {/* Items list header */}
        <div className="flex items-center justify-between px-1 pt-2">
          <div className="text-[11px] font-bold text-zinc-600">قائمة الأصناف · {formatNumber(total, 0)}</div>
          {selectedIds.size > 0 && (
            <button
              onClick={() => onSelected(new Set())}
              className="text-[11px] text-zinc-500 underline"
            >
              إلغاء التحديد ({selectedIds.size})
            </button>
          )}
        </div>

        {/* Items */}
        {!items || items.length === 0 ? (
          <div className="bg-white rounded-2xl border border-zinc-200 py-14 text-center">
            <Package className="h-10 w-10 mx-auto text-zinc-300 mb-3" />
            <p className="text-sm text-zinc-500">لا توجد أصناف مطابقة</p>
          </div>
        ) : (
          items.map((it: any) => {
            const stock = Number(it.totalStock ?? 0);
            const cost = Number(it.avgCost ?? it.costPrice ?? 0);
            const value = stock * cost;
            const status = stock <= 0 ? 'OUT'
              : it.safetyStock != null && stock < Number(it.safetyStock) ? 'CRITICAL'
              : it.isLow ? 'LOW' : 'OK';
            const checked = selectedIds.has(it.id);
            return (
              <div
                key={`m-${it.id}`}
                className={cn(
                  'bg-white rounded-2xl border p-3',
                  checked ? 'border-zinc-900 ring-2 ring-zinc-900/10' : 'border-zinc-200',
                )}
                style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}
              >
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      const next = new Set(selectedIds);
                      checked ? next.delete(it.id) : next.add(it.id);
                      onSelected(next);
                    }}
                    className="mt-1 w-5 h-5"
                    aria-label={`تحديد ${it.name}`}
                  />
                  <div className="flex-1 min-w-0">
                    <button
                      type="button"
                      onClick={() => router.push(`/inventory/items/${it.id}`)}
                      className="w-full text-right active:opacity-80"
                    >
                      <div className="flex items-start justify-between">
                        <div className="min-w-0">
                          <div className="font-mono text-[10px] text-zinc-500">{it.sku}</div>
                          <div className="font-bold text-[14px] text-zinc-900 mt-0.5 leading-tight">{it.name}</div>
                          <div className="text-[10px] text-zinc-500 mt-1">{TYPE_LABEL[it.type] ?? it.type} · {it.unit}</div>
                        </div>
                        <div className="text-left shrink-0 pl-2">
                          <div className="font-black text-[15px] text-zinc-900" data-numeric>
                            {formatNumber(stock, 0)}
                            <span className="text-[10px] text-zinc-400 mr-1">{it.unit}</span>
                          </div>
                          <div className="mt-1">{itemStatusBadge(status)}</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-dashed border-zinc-200">
                        <div>
                          <div className="text-[9px] text-zinc-500">التكلفة</div>
                          <div className="text-[11px] font-bold text-zinc-900 mt-0.5" data-numeric>
                            {cost > 0 ? formatNumber(cost, 2) : '—'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[9px] text-zinc-500">القيمة</div>
                          <div className="text-[11px] font-bold text-emerald-700 mt-0.5" data-numeric>{formatNumber(value, 0)}</div>
                        </div>
                        <div>
                          <div className="text-[9px] text-zinc-500">أدنى</div>
                          <div className="text-[11px] font-bold text-zinc-900 mt-0.5" data-numeric>
                            {it.safetyStock != null ? formatNumber(it.safetyStock, 0) : '—'}
                          </div>
                        </div>
                      </div>
                    </button>
                    <div className="flex gap-1.5 mt-2.5">
                      <button
                        type="button"
                        onClick={() => onEditItem(it, stock)}
                        className="flex-1 min-h-[34px] rounded-lg bg-blue-50 text-blue-800 text-[11px] font-bold flex items-center justify-center gap-1 active:bg-blue-100"
                      >
                        <Wrench className="h-3.5 w-3.5" /> تعديل
                      </button>
                      <Link
                        href={`/inventory/items/${it.id}`}
                        className="flex-1 min-h-[34px] rounded-lg bg-zinc-100 text-zinc-800 text-[11px] font-bold flex items-center justify-center gap-1 active:bg-zinc-200"
                      >
                        تفاصيل &amp; سجل
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-2 mt-3">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => onPage(page - 1)}
              className="flex-1 min-h-[44px] rounded-xl bg-white border border-zinc-200 text-sm font-bold text-zinc-800 disabled:opacity-40 active:bg-zinc-50"
            >
              السابق
            </button>
            <div className="text-[11px] font-bold text-zinc-500 px-2">
              {page + 1} / {totalPages}
            </div>
            <button
              type="button"
              disabled={!hasMore}
              onClick={() => onPage(page + 1)}
              className="flex-1 min-h-[44px] rounded-xl bg-white border border-zinc-200 text-sm font-bold text-zinc-800 disabled:opacity-40 active:bg-zinc-50"
            >
              التالي
            </button>
          </div>
        )}
      </div>

      {/* Bulk action bar — sticky above nav */}
      {selectedIds.size > 0 && (
        <div
          className="fixed left-3 right-3 bottom-[72px] bg-zinc-900 text-white rounded-2xl px-3 py-2.5 z-30 flex items-center justify-between shadow-lg"
          style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          <div className="text-sm font-bold" data-numeric>{selectedIds.size} صنف محدّد</div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onBulkActivate}
              disabled={bulkPending}
              className="bg-emerald-600 text-white text-xs font-bold px-3 py-2 rounded-lg flex items-center gap-1 disabled:opacity-60"
            >
              <Power className="h-3.5 w-3.5" /> تفعيل
            </button>
            <button
              type="button"
              onClick={onBulkDeactivate}
              disabled={bulkPending}
              className="border border-white/30 text-white text-xs font-bold px-3 py-2 rounded-lg flex items-center gap-1 disabled:opacity-60"
            >
              <PowerOff className="h-3.5 w-3.5" /> تعطيل
            </button>
          </div>
        </div>
      )}

      {/* Actions sheet */}
      {showActions && (
        <BottomSheet title="إجراءات المخزون" onClose={() => setShowActions(false)}>
          <SheetGroup label="حركات وإدخالات">
            <SheetRow
              icon={<Truck className="h-4 w-4" />}
              iconTone="good"
              title="إضافة كمية للمخزون"
              subtitle="استلام مواد جديدة"
              onClick={() => { closeSheets(); router.push('/inventory/receive'); }}
            />
            <SheetRow
              icon={<Wrench className="h-4 w-4" />}
              iconTone="info"
              title="تعديل مخزون"
              subtitle="تصحيح الكميات"
              onClick={() => { closeSheets(); router.push('/inventory/adjust'); }}
            />
            <SheetRow
              icon={<ClipboardList className="h-4 w-4" />}
              iconTone="warn"
              title="الجرد"
              subtitle="إنشاء وإدارة جرد فعلي"
              onClick={() => { closeSheets(); router.push('/inventory/counts'); }}
            />
          </SheetGroup>
          <SheetGroup label="استيراد / تصدير">
            <SheetRow
              icon={<Upload className="h-4 w-4" />}
              title="استيراد Excel"
              onClick={() => { closeSheets(); router.push('/inventory/import'); }}
            />
            <SheetRow
              icon={<Download className="h-4 w-4" />}
              iconTone="pro"
              title="تصدير Excel"
              subtitle="قيمة · حركة · منخفضة · راكدة"
              onClick={() => { setShowActions(false); setShowExport(true); }}
            />
          </SheetGroup>
        </BottomSheet>
      )}

      {/* Export sub-sheet */}
      {showExport && (
        <BottomSheet title="تصدير Excel" onClose={() => setShowExport(false)}>
          {[
            { path: '/inventory/reports/stock-value.xlsx', file: 'stock-value.xlsx', label: 'قيمة المخزون' },
            { path: '/inventory/reports/movement.xlsx',   file: 'movement.xlsx',    label: 'حركة المخزون (30 يوم)' },
            { path: '/inventory/reports/low-stock.xlsx',  file: 'low-stock.xlsx',   label: 'مواد منخفضة' },
            { path: '/inventory/reports/dead-stock.xlsx', file: 'dead-stock.xlsx',  label: 'مواد راكدة' },
          ].map((e) => (
            <SheetRow
              key={e.path}
              icon={<Download className="h-4 w-4" />}
              title={e.label}
              subtitle="Excel"
              onClick={() => { downloadCsv(e.path, e.file); setShowExport(false); }}
            />
          ))}
        </BottomSheet>
      )}

      {/* Filter sheet */}
      {showFilter && (
        <BottomSheet title="فلترة الأصناف" onClose={() => setShowFilter(false)}>
          <div className="px-4 pt-3 pb-4">
            <div className="text-[11px] text-zinc-500 font-bold mb-2">نوع الصنف</div>
            <div className="grid grid-cols-2 gap-2">
              <FilterPill label="الكل" active={typeFilter === ''} onClick={() => onTypeFilter('')} />
              {Object.entries(TYPE_LABEL).map(([k, l]) => (
                <FilterPill key={k} label={l} active={typeFilter === k} onClick={() => onTypeFilter(k)} />
              ))}
            </div>
          </div>
          <div className="px-4 pb-4">
            <div className="text-[11px] text-zinc-500 font-bold mb-2">فلاتر محفوظة</div>
            {savedFilters.length === 0 ? (
              <p className="text-[11px] text-zinc-400">لا يوجد فلاتر محفوظة بعد.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {savedFilters.map((f: any) => (
                  <button
                    key={f.name}
                    onClick={() => { onApplySaved(f); setShowFilter(false); }}
                    className="min-h-[36px] px-3 rounded-lg bg-zinc-100 text-zinc-800 text-xs font-bold active:bg-zinc-200"
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={onSaveFilter}
              className="mt-3 w-full min-h-[44px] rounded-xl bg-white border border-zinc-200 text-sm font-bold text-zinc-800 flex items-center justify-center gap-1.5 active:bg-zinc-50"
            >
              <FilterIcon className="h-4 w-4" /> حفظ الفلتر الحالي
            </button>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}

/* ─── Shared mobile primitives (Inventory) ─── */

function InvKpi({ label, value, tone = 'neutral', unit }: {
  label: string;
  value: string;
  tone?: 'neutral' | 'good' | 'warn' | 'danger';
  unit?: string;
}) {
  const cls =
    tone === 'good'   ? 'text-emerald-700' :
    tone === 'warn'   ? 'text-amber-700' :
    tone === 'danger' ? 'text-red-700' :
    'text-zinc-900';
  return (
    <div className="flex-shrink-0 bg-white border border-zinc-200 rounded-xl px-3 py-2 min-w-[104px]">
      <div className="text-[10px] text-zinc-500">{label}</div>
      <div className={cn('font-black text-base mt-0.5 leading-none', cls)} data-numeric>
        {value}
        {unit && <span className="text-[10px] font-bold text-zinc-400 mr-1">{unit}</span>}
      </div>
    </div>
  );
}

function InvSection({
  icon, title, count, open, onToggle, children,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-3 py-3 active:bg-zinc-50 min-h-[48px]"
      >
        <div className="flex items-center gap-2 text-sm font-bold text-zinc-900">
          {icon}
          {title}
          {typeof count === 'number' && count > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-700">{count}</span>
          )}
        </div>
        <span className={cn('text-zinc-400 text-lg transition-transform', open && 'rotate-180')}>⌄</span>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

function BottomSheet({
  title, onClose, children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  return (
    <div className="md:hidden fixed inset-0 z-50 flex items-end" role="dialog" aria-modal="true" aria-label={title} dir="rtl">
      <div className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative w-full max-h-[85vh] bg-white rounded-t-2xl flex flex-col shadow-2xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="pt-2 pb-1 flex justify-center"><div className="h-1 w-10 rounded-full bg-zinc-300" /></div>
        <div className="px-4 py-2.5 flex items-center justify-between border-b border-zinc-100">
          <div className="text-sm font-bold text-zinc-900">{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-zinc-100 active:bg-zinc-200"
          >
            <X className="h-5 w-5 text-zinc-700" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">{children}</div>
      </div>
    </div>
  );
}

function SheetGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-bold text-zinc-500 tracking-wide px-4 pt-3 pb-1">{label}</div>
      {children}
    </div>
  );
}

function SheetRow({
  icon, title, subtitle, onClick, iconTone,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  onClick: () => void;
  iconTone?: 'good' | 'info' | 'warn' | 'pro';
}) {
  const toneCls =
    iconTone === 'good' ? 'bg-emerald-50 text-emerald-700' :
    iconTone === 'info' ? 'bg-blue-50 text-blue-700' :
    iconTone === 'warn' ? 'bg-amber-50 text-amber-700' :
    iconTone === 'pro'  ? 'bg-violet-50 text-violet-700' :
    'bg-zinc-100 text-zinc-700';
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 mx-2 my-0.5 rounded-xl active:bg-zinc-50 min-h-[48px]"
    >
      <span className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', toneCls)}>{icon}</span>
      <div className="flex-1 min-w-0 text-right">
        <div className="text-sm font-bold text-zinc-900">{title}</div>
        {subtitle && <div className="text-[10px] text-zinc-500 mt-0.5">{subtitle}</div>}
      </div>
      <span className="text-zinc-300 text-lg">‹</span>
    </button>
  );
}

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'min-h-[44px] rounded-xl text-sm font-bold px-3',
        active ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-800',
      )}
    >
      {label}
    </button>
  );
}

/* ═════════════════════════════════════════════
   Modal: إضافة صنف جديد
════════════════════════════════════════════ */
function NewItemModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: '',
    sku: '',
    barcode: '',
    type: 'CONSUMABLE',
    unit: 'PCS',
    initialQty: '',
    costPrice: '',
    minStock: '',
    reorderLevel: '',
    productionReorderLevel: '',
    notes: '',
    active: true,
  });
  const [saving, setSaving] = useState(false);
  const [duplicate, setDuplicate] = useState<any>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('اسم الصنف مطلوب');
    setSaving(true);
    setDuplicate(null);
    try {
      const created = await api
        .post('/inventory/items', {
          name: form.name.trim(),
          sku: form.sku.trim() || undefined,
          barcode: form.barcode.trim() || undefined,
          type: form.type,
          unit: form.unit,
          costPrice: form.costPrice ? +form.costPrice : undefined,
          minStock: form.minStock ? +form.minStock : undefined,
          reorderLevel: form.reorderLevel ? +form.reorderLevel : undefined,
          productionReorderLevel: form.productionReorderLevel ? +form.productionReorderLevel : undefined,
          notes: form.notes.trim() || undefined,
          active: form.active,
          bagWeightKg: form.unit === 'BAG' ? 25 : undefined,
        })
        .then((r) => r.data);

      // إذا أدخل المستخدم كمية أولية، سجّل استلاماً على "المخزن الرئيسي" تلقائياً
      const qty = parseFloat(form.initialQty);
      if (qty > 0) {
        try {
          await api.post('/inventory/receive', {
            itemId: created.id,
            source: 'MANUAL',
            quantity: qty,
            unitCost: form.costPrice ? +form.costPrice : undefined,
            notes: 'كمية ابتدائية عند إنشاء الصنف',
          });
        } catch {
          /* حتى لو فشلت الكمية الابتدائية، الصنف تم إنشاؤه */
        }
      }
      onCreated();
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'تعذّر إنشاء الصنف';
      if (/مكرر|موجود/.test(msg)) {
        setDuplicate({ message: msg });
      } else {
        toast.error(msg);
      }
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
            <Plus className="h-5 w-5 text-emerald-600" />
            <h3 className="font-bold text-lg">إضافة صنف جديد · Add New Item</h3>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          {duplicate && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900">
              <b>⚠️ صنف مكرر:</b> {duplicate.message}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => { setDuplicate(null); onClose(); }}
                  className="text-xs px-2 py-1 rounded bg-amber-600 text-white"
                >
                  فتح المخزون
                </button>
                <button
                  type="button"
                  onClick={() => setDuplicate(null)}
                  className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-800"
                >
                  المتابعة بأسماء/أكواد مختلفة
                </button>
              </div>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-bold text-zinc-700">اسم الصنف *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
                required
                autoFocus
                placeholder="مثال: كرتون حليب 500مل"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-700">SKU</label>
              <input
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
                placeholder="سيُولّد تلقائياً إن ترك فارغاً"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-700">الباركود</label>
              <input
                value={form.barcode}
                onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-700">التصنيف / النوع *</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
              >
                <option value="POWDER_BULK">بودرة بالجملة</option>
                <option value="PACKAGING">مواد تغليف</option>
                <option value="POWDER_RETAIL">منتج نهائي</option>
                <option value="CONSUMABLE">مستهلكات</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-700">الوحدة *</label>
              <select
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
              >
                <option value="PCS">حبة / PCS</option>
                <option value="CTN">كرتون / CARTON</option>
                <option value="KG">كيلوغرام / KG</option>
                <option value="G">غرام / G</option>
                <option value="BAG">شوال / BAG (25 كغ)</option>
                <option value="ROLL">رول / ROLL</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-700">الكمية الابتدائية</label>
              <input
                type="number"
                step="0.001"
                value={form.initialQty}
                onChange={(e) => setForm({ ...form, initialQty: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
                placeholder="اختياري — يُسجَّل استلام يدوي على المخزن الرئيسي"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-700">سعر الشراء / التكلفة</label>
              <input
                type="number"
                step="0.01"
                value={form.costPrice}
                onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-700">الحد الأدنى للمخزون</label>
              <input
                type="number"
                step="0.01"
                value={form.minStock}
                onChange={(e) => setForm({ ...form, minStock: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-700">نقطة إعادة الطلب</label>
              <input
                type="number"
                step="0.01"
                value={form.reorderLevel}
                onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-700">نقطة إعادة الإنتاج</label>
              <input
                type="number"
                step="0.01"
                value={form.productionReorderLevel}
                onChange={(e) => setForm({ ...form, productionReorderLevel: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-bold text-zinc-700">ملاحظات / وصف اختياري</label>
              <input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm font-bold text-zinc-700">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
            صنف فعّال / متاح
          </label>

          <div className="rounded-lg bg-blue-50 border border-blue-100 p-2 text-[11px] text-blue-800">
            📦 يُخزَّن في «المخزن الرئيسي / Main Warehouse» — المصنع يعمل بمخزن واحد فقط.
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-zinc-100">
            <Button type="button" variant="ghost" onClick={onClose}>إلغاء</Button>
            <Button type="submit" loading={saving} disabled={saving}>
              <Plus className="h-4 w-4" /> حفظ الصنف
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════
   Modal: تعديل صنف موجود
   تغيير الكمية يُسجَّل كـ StockAdjustment (Audit).
════════════════════════════════════════════ */
function EditItemModal({
  item,
  onClose,
  onSaved,
}: {
  item: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const currentQty = Number(item.currentStock ?? item.qty ?? 0);
  const [form, setForm] = useState({
    name: item.name ?? '',
    sku: item.sku ?? '',
    barcode: item.barcode ?? '',
    type: item.type ?? 'CONSUMABLE',
    unit: item.unit ?? 'PCS',
    costPrice: item.costPrice ? String(item.costPrice) : '',
    minStock: item.minStock ? String(item.minStock) : '',
    reorderLevel: item.reorderLevel ? String(item.reorderLevel) : '',
    productionReorderLevel: item.productionReorderLevel ? String(item.productionReorderLevel) : '',
    active: item.active !== false,
    newQty: String(currentQty),
    qtyReason: '',
  });
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('اسم الصنف مطلوب');
    setSaving(true);
    try {
      // 1) تحديث خصائص الصنف (بدون كمية)
      await api.patch(`/inventory/items/${item.id}`, {
        name: form.name.trim(),
        barcode: form.barcode.trim() || undefined,
        unit: form.unit,
        costPrice: form.costPrice ? +form.costPrice : undefined,
      });
      await api.patch(`/inventory/items/${item.id}/settings`, {
        minStock: form.minStock ? +form.minStock : null,
        reorderPoint: form.reorderLevel ? +form.reorderLevel : null,
        productionReorderLevel: form.productionReorderLevel ? +form.productionReorderLevel : null,
      });

      // 2) تعديل الكمية → يُنشئ StockAdjustment مع سبب واضح
      const newQty = parseFloat(form.newQty);
      if (!isNaN(newQty) && Math.abs(newQty - currentQty) > 1e-6) {
        if (!form.qtyReason.trim()) {
          toast.error('عند تعديل الكمية يجب إدخال سبب واضح');
          setSaving(false);
          return;
        }
        await api.post('/inventory/adjust', {
          itemId: item.id,
          type: 'COUNT',        // COUNT يعيّن الكمية إلى قيمة مطلقة ويحفظ delta
          quantity: newQty,
          reason: form.qtyReason.trim(),
          notes: `تعديل يدوي من الواجهة: ${currentQty} → ${newQty}`,
        });
      }
      onSaved();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'تعذّر التعديل');
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
        className="bg-white rounded-2xl w-full max-w-xl max-h-[92vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white flex items-center justify-between p-5 border-b border-zinc-100 z-10">
          <h3 className="font-bold text-lg">تعديل الصنف: {item.name}</h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-bold text-zinc-700">الاسم *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-700">SKU</label>
              <input value={form.sku} disabled className="w-full h-10 px-3 rounded-lg border border-zinc-200 bg-zinc-50 text-sm text-zinc-500" title="SKU لا يمكن تعديله" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-700">الباركود</label>
              <input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-700">الوحدة</label>
              <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm">
                <option value="PCS">حبة / PCS</option>
                <option value="CTN">كرتون / CARTON</option>
                <option value="KG">كيلوغرام / KG</option>
                <option value="G">غرام / G</option>
                <option value="BAG">شوال / BAG</option>
                <option value="ROLL">رول / ROLL</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-700">التكلفة</label>
              <input type="number" step="0.01" value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-700">الحد الأدنى</label>
              <input type="number" step="0.01" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-700">نقطة إعادة الطلب</label>
              <input type="number" step="0.01" value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-700">نقطة إعادة الإنتاج</label>
              <input type="number" step="0.01" value={form.productionReorderLevel} onChange={(e) => setForm({ ...form, productionReorderLevel: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm" />
            </div>
          </div>

          {/* ─── تعديل الكمية → يُنشئ Stock Adjustment مع سبب ─── */}
          <div className="rounded-xl bg-amber-50 border border-amber-100 p-3 space-y-3">
            <div className="text-xs font-bold text-amber-800">تعديل الكمية (يُسجَّل كحركة StockAdjustment)</div>
            <div className="grid md:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-700">الكمية الحالية</label>
                <input value={currentQty} disabled className="w-full h-10 px-3 rounded-lg border border-zinc-200 bg-zinc-50 text-sm text-zinc-600" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-700">الكمية الجديدة</label>
                <input type="number" step="0.001" value={form.newQty} onChange={(e) => setForm({ ...form, newQty: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-700">الفارق (Δ)</label>
                <input
                  value={(Number(form.newQty || 0) - currentQty).toFixed(3)}
                  disabled
                  className="w-full h-10 px-3 rounded-lg border border-zinc-200 bg-zinc-50 text-sm text-zinc-600"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-700">سبب تغيير الكمية</label>
              <input
                value={form.qtyReason}
                onChange={(e) => setForm({ ...form, qtyReason: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
                placeholder="مطلوب فقط عند تغيير الكمية"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm font-bold text-zinc-700">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            الصنف فعّال
          </label>

          <div className="flex justify-end gap-3 pt-2 border-t border-zinc-100">
            <Button type="button" variant="ghost" onClick={onClose}>إلغاء</Button>
            <Button type="submit" loading={saving} disabled={saving}>حفظ التعديلات</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
