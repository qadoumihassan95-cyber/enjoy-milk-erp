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
