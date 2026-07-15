'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Trash2, X, ShoppingCart, Phone, MapPin, Wallet, Receipt, Printer, Pencil, Building2, Truck, Copy, Check, SlidersHorizontal, ChevronLeft } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, Button, Input, Badge, Stat } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/api';
import { formatCurrency, formatDate, cn } from '@/lib/utils';

const PAYMENT_METHODS = [
  { value: 'CASH', label: 'كاش' },
  { value: 'TRANSFER', label: 'حوالة' },
  { value: 'CHEQUE', label: 'شيك' },
  { value: 'OTHER', label: 'أخرى' },
];
const METHOD_LABEL: Record<string, string> = {
  CASH: 'كاش',
  TRANSFER: 'حوالة',
  CHEQUE: 'شيك',
  OTHER: 'أخرى',
};

export default function OrdersPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [orderType, setOrderType] = useState<string>(''); // '' | INTERNAL | EXTERNAL
  const [showNew, setShowNew] = useState(false);
  const [editingOrder, setEditingOrder] = useState<any>(null);
  const [paymentsOrder, setPaymentsOrder] = useState<any>(null);
  // Mobile-only: filter bottom sheet
  const [showFilterSheet, setShowFilterSheet] = useState(false);
  const activeFilterCount = (filter ? 1 : 0) + (orderType ? 1 : 0);

  const { data: orders, refetch } = useQuery({
    queryKey: ['orders', filter, search, orderType],
    queryFn: () =>
      api
        .get('/orders', { params: {
          status: filter || undefined,
          search: search || undefined,
          orderType: orderType || undefined,
        }})
        .then((r) => r.data),
  });

  const { data: report } = useQuery({
    queryKey: ['orders-report'],
    queryFn: () => api.get('/orders/report').then((r) => r.data),
  });

  // تحديث «أفضل جهد» — لا يؤثر على رسالة نجاح العملية
  const safeRefresh = async () => {
    try {
      await refetch();
      await qc.invalidateQueries({ queryKey: ['orders-report'] });
    } catch {
      /* تجاهل — العملية نجحت، فقط تعذّر التحديث الفوري */
    }
  };

  const remove = async (orderId: string) => {
    if (!confirm('سيتم إرجاع الكمية للمخزون. حذف الطلبية؟')) return;
    try {
      await api.delete(`/orders/${orderId}`);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'تعذّر الحذف');
      return;
    }
    await safeRefresh();
    toast.success('تم حذف الطلبية');
  };

  return (
    <AppShell>
      {/* ═══════════════════════════════════════════════
          DESKTOP (≥ md) — UNCHANGED. Wrapped in hidden md:block.
      ═══════════════════════════════════════════════ */}
      <div className="hidden md:block max-w-6xl mx-auto p-4 md:p-6 space-y-6 print:p-2 print:space-y-2">
        <header className="flex items-center justify-between flex-wrap gap-3 print:hidden">
          <div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight">الطلبيات</h1>
            <p className="text-sm text-zinc-500 mt-0.5">
              {orders?.length ?? 0} طلبية
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> طباعة
            </Button>
            <Button onClick={() => setShowNew(true)}>
              <Plus className="h-4 w-4" />
              طلبية جديدة
            </Button>
          </div>
        </header>

        {/* رأس الطباعة */}
        <div className="hidden print:block mb-4">
          <h1 className="text-lg font-black">مصنع الدانا لمنتجات الحليب واللبن — تقرير الطلبيات</h1>
          <p className="text-xs text-zinc-500">
            {new Date().toLocaleDateString('ar-JO', { dateStyle: 'long' })}
            {orderType && ` · ${orderType === 'INTERNAL' ? 'داخلية' : 'خارجية'}`}
            {filter && ` · ${filter}`}
          </p>
        </div>

        {/* Report KPIs */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat
            label="إجمالي الطلبيات"
            value={report?.ordersCount ?? 0}
          />
          <Stat
            label="الإجمالي"
            value={(report?.totalAmount ?? 0).toFixed(0)}
            unit="د.أ"
          />
          <Stat
            label="المدفوع"
            value={(report?.totalPaid ?? 0).toFixed(0)}
            unit="د.أ"
            state="good"
          />
          <Stat
            label="المتبقي"
            value={(report?.totalBalance ?? 0).toFixed(0)}
            unit="د.أ"
            state={(report?.totalBalance ?? 0) > 0 ? 'warning' : 'good'}
          />
        </section>

        {/* Order type tabs — الداخلية / الخارجية */}
        <div className="flex gap-2 print:hidden">
          {[
            { v: '', l: 'كل الطلبيات', Icon: ShoppingCart },
            { v: 'INTERNAL', l: 'داخلية', Icon: Building2 },
            { v: 'EXTERNAL', l: 'خارجية', Icon: Truck },
          ].map((t) => {
            const Ic = t.Icon;
            return (
              <button
                key={t.v}
                onClick={() => setOrderType(t.v)}
                className={cn(
                  'px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2',
                  orderType === t.v
                    ? 'bg-zinc-900 text-white'
                    : 'bg-white text-zinc-700 border border-zinc-200 hover:bg-zinc-50',
                )}
              >
                <Ic className="h-4 w-4" />
                {t.l}
              </button>
            );
          })}
        </div>

        {/* Filters */}
        <Card className="p-3 flex flex-wrap gap-3 items-center print:hidden">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <Input
              placeholder="بحث بالعميل، الهاتف، رقم العقد، أو رقم الشحنة..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pr-9"
            />
          </div>
          <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-0.5">
            {[
              { v: '', l: 'الكل' },
              { v: 'UNPAID', l: 'غير مدفوع' },
              { v: 'PARTIAL', l: 'مدفوع جزئي' },
              { v: 'PAID', l: 'مدفوع كامل' },
            ].map((opt) => (
              <button
                key={opt.v}
                onClick={() => setFilter(opt.v)}
                className={cn(
                  'px-3 py-1.5 text-xs font-semibold rounded-md transition-colors',
                  filter === opt.v
                    ? 'bg-zinc-900 text-white'
                    : 'text-zinc-600 hover:bg-zinc-50',
                )}
              >
                {opt.l}
              </button>
            ))}
          </div>
        </Card>

        {/* Orders list */}
        <Card>
          {!orders || orders.length === 0 ? (
            <div className="p-12 text-center">
              <ShoppingCart className="h-12 w-12 mx-auto text-zinc-300 mb-3" />
              <p className="text-zinc-500">لا توجد طلبيات</p>
            </div>
          ) : (
            <>
            <div className="overflow-x-auto hidden md:block">
              <table className="w-full text-sm min-w-[1400px]">
                <thead className="bg-zinc-50 border-b">
                  <tr>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase whitespace-nowrap">رقم</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase whitespace-nowrap">النوع</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase whitespace-nowrap">العميل</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase whitespace-nowrap">الهاتف</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase whitespace-nowrap">المنطقة</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase whitespace-nowrap">التاريخ</th>
                    {/* ─── الأعمدة الجديدة: بيانات الشحن ─── */}
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase whitespace-nowrap">موقع التسليم</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase whitespace-nowrap">رقم الشحنة</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase whitespace-nowrap">تاريخ الشحن</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase whitespace-nowrap">تاريخ الوصول</th>
                    {/* ─── أعمدة مالية جديدة (سعر الطن + الشحن) ─── */}
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase whitespace-nowrap bg-sky-50">الكمية بالطن</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase whitespace-nowrap bg-sky-50">سعر الطن</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase whitespace-nowrap bg-sky-50">إجمالي البضاعة</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase whitespace-nowrap bg-sky-50">أجور الشحن</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase whitespace-nowrap bg-cyan-50">الإجمالي النهائي</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase whitespace-nowrap bg-emerald-50">المسدد</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase whitespace-nowrap bg-amber-50">المتبقي</th>
                    {/* الأعمدة القديمة للـ backward compat محذوفة لأنها مُدمجة أعلاه */}
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase whitespace-nowrap">الحالة</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase print:hidden whitespace-nowrap sticky left-0 bg-zinc-50">إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o: any) => {
                    const isExternal = o.orderType === 'EXTERNAL';
                    return (
                      <tr key={o.id} className="border-b border-zinc-100 hover:bg-zinc-50">
                        <td className="p-3 font-mono text-xs whitespace-nowrap">{o.number}</td>
                        <td className="p-3">
                          {isExternal ? (
                            <Badge variant="info" dot>خارجية</Badge>
                          ) : (
                            <Badge variant="default" dot>داخلية</Badge>
                          )}
                        </td>
                        <td className="p-3 font-medium whitespace-nowrap">
                          {o.customerId ? (
                            <a
                              href={`/customers/${o.customerId}`}
                              className="text-zinc-900 hover:text-blue-600 hover:underline"
                              title="فتح ملف العميل"
                            >
                              {o.customerName}
                            </a>
                          ) : (
                            <span title="عميل حر (بدون ربط)">{o.customerName}</span>
                          )}
                        </td>
                        <td className="p-3 text-zinc-600 whitespace-nowrap">{o.customerPhone || '—'}</td>
                        <td className="p-3 text-zinc-600 whitespace-nowrap">{o.region || '—'}</td>
                        <td className="p-3 text-zinc-600 whitespace-nowrap">{formatDate(o.orderDate)}</td>
                        {/* ─── القيم الجديدة: الشحن ─── */}
                        <td className="p-3 text-zinc-700 max-w-[180px]">
                          <LocationCell value={o.deliveryLocation} isExternal={isExternal} />
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          <TrackingCell value={o.shipmentTrackingNumber} isExternal={isExternal} />
                        </td>
                        <td className="p-3 text-zinc-600 whitespace-nowrap">
                          {isExternal
                            ? (o.expectedShippingDate ? formatDate(o.expectedShippingDate) : '—')
                            : '—'}
                        </td>
                        <td className="p-3 text-zinc-600 whitespace-nowrap">
                          {isExternal
                            ? (o.expectedArrivalDate ? formatDate(o.expectedArrivalDate) : '—')
                            : '—'}
                        </td>
                        {/* ─── القيم المالية الجديدة ─── */}
                        {(() => {
                          // نجمع كميات الطن من الأسطر ذات الوحدة TON، وإجمالي البضاعة + الشحن
                          const lines = o.lines ?? [];
                          const tonsQty = lines
                            .filter((l: any) => String(l.unit || '').toUpperCase() === 'TON')
                            .reduce((s: number, l: any) => s + Number(l.quantity || 0), 0);
                          const productsTotal = Number(o.productsTotal ?? 0) || lines.reduce((s: number, l: any) => s + Number(l.lineTotal || 0), 0);
                          const shipping = Number(o.shippingCost ?? 0);
                          const total = Number(o.total ?? 0);
                          const paid = Number(o.paid ?? 0);
                          const balance = Number(o.balance ?? 0);
                          const showFin = isExternal || tonsQty > 0;
                          const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                          return (
                            <>
                              <td className="p-3 whitespace-nowrap bg-sky-50/40" data-numeric>{showFin && tonsQty > 0 ? fmt(tonsQty) : '—'}</td>
                              <td className="p-3 whitespace-nowrap bg-sky-50/40" data-numeric>{o.tonPrice != null ? fmt(Number(o.tonPrice)) : '—'}</td>
                              <td className="p-3 font-bold whitespace-nowrap bg-sky-50/40" data-numeric>{fmt(productsTotal)}</td>
                              <td className="p-3 whitespace-nowrap bg-sky-50/40" data-numeric>{shipping > 0 || isExternal ? fmt(shipping) : '—'}</td>
                              <td className="p-3 font-black whitespace-nowrap bg-cyan-50/60" data-numeric>{fmt(total)}</td>
                              <td className="p-3 text-emerald-700 font-bold whitespace-nowrap bg-emerald-50/40" data-numeric>{fmt(paid)}</td>
                              <td className={cn('p-3 font-bold whitespace-nowrap bg-amber-50/40', balance > 0 ? 'text-amber-600' : 'text-zinc-500')} data-numeric>{fmt(balance)}</td>
                            </>
                          );
                        })()}
                        <td className="p-3 whitespace-nowrap">
                          {o.status === 'PAID' ? (
                            <Badge variant="success" dot>مدفوع</Badge>
                          ) : o.status === 'PARTIAL' ? (
                            <Badge variant="warning" dot>جزئي</Badge>
                          ) : (
                            <Badge variant="danger" dot>غير مدفوع</Badge>
                          )}
                        </td>
                        <td className="p-3 flex gap-1 print:hidden whitespace-nowrap sticky left-0 bg-white group-hover:bg-zinc-50">
                          <button
                            onClick={() => setPaymentsOrder(o)}
                            className="text-xs px-2 py-1 rounded bg-zinc-100 text-zinc-700 hover:bg-zinc-200 font-bold inline-flex items-center gap-1"
                            title="الدفعات"
                          >
                            <Receipt className="h-3 w-3" /> دفعات
                          </button>
                          {Number(o.balance) > 0 && (
                            <button
                              onClick={() => setPaymentsOrder(o)}
                              className="text-xs px-2 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-bold inline-flex items-center gap-1"
                            >
                              <Wallet className="h-3 w-3" /> دفعة
                            </button>
                          )}
                          <button
                            onClick={() => setEditingOrder(o)}
                            className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 font-bold inline-flex items-center gap-1"
                            title="تعديل"
                          >
                            <Pencil className="h-3 w-3" /> تعديل
                          </button>
                          <button
                            onClick={() => remove(o.id)}
                            className="text-red-500 hover:text-red-700 p-1"
                            title="حذف"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ─── بطاقات جوّال (mobile only) لعرض بيانات الشحن كاملة ── */}
            <div className="md:hidden divide-y divide-zinc-100">
              {orders.map((o: any) => {
                const isExternal = o.orderType === 'EXTERNAL';
                return (
                  <div key={`m-${o.id}`} className="p-3 space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <div className="font-mono text-xs text-zinc-500">{o.number}</div>
                      {isExternal ? (
                        <Badge variant="info" dot>خارجية</Badge>
                      ) : (
                        <Badge variant="default" dot>داخلية</Badge>
                      )}
                    </div>
                    <div className="font-bold">{o.customerName}</div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
                      <MobileField label="الهاتف" value={o.customerPhone || '—'} />
                      <MobileField label="المنطقة" value={o.region || '—'} />
                      <MobileField label="التاريخ" value={formatDate(o.orderDate)} />
                      <MobileField label="موقع التسليم" value={isExternal ? (o.deliveryLocation || '—') : '—'} />
                      <MobileField label="رقم الشحنة" value={isExternal ? (o.shipmentTrackingNumber || '—') : '—'} mono />
                      <MobileField label="تاريخ الشحن" value={isExternal && o.expectedShippingDate ? formatDate(o.expectedShippingDate) : '—'} />
                      <MobileField label="تاريخ الوصول" value={isExternal && o.expectedArrivalDate ? formatDate(o.expectedArrivalDate) : '—'} />
                      <MobileField label="الإجمالي" value={Number(o.total).toFixed(2)} />
                      <MobileField label="المدفوع" value={Number(o.paid).toFixed(2)} />
                      <MobileField label="المتبقي" value={Number(o.balance).toFixed(2)} />
                    </div>
                    <div className="flex gap-1 pt-1">
                      <button onClick={() => setPaymentsOrder(o)} className="text-xs px-2 py-1 rounded bg-zinc-100 flex-1"><Receipt className="h-3 w-3 inline" /> دفعات</button>
                      <button onClick={() => setEditingOrder(o)} className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700 flex-1"><Pencil className="h-3 w-3 inline" /> تعديل</button>
                      <button onClick={() => remove(o.id)} className="text-xs px-2 py-1 rounded text-red-500"><Trash2 className="h-3.5 w-3.5 inline" /></button>
                    </div>
                  </div>
                );
              })}
            </div>
            </>
          )}
        </Card>

      </div>

      {/* ═══════════════════════════════════════════════
          MOBILE (< md) — new professional layout.
          All desktop features preserved: search, both filter
          dimensions (payment status + order type), all row
          actions, print, new order, edit, delete, payments.
      ═══════════════════════════════════════════════ */}
      <MobileOrders
        orders={orders}
        report={report}
        search={search}
        onSearch={setSearch}
        filter={filter}
        orderType={orderType}
        activeFilterCount={activeFilterCount}
        onOpenFilters={() => setShowFilterSheet(true)}
        onNewOrder={() => setShowNew(true)}
        onOpenPayments={(o) => setPaymentsOrder(o)}
        onEdit={(o) => setEditingOrder(o)}
        onDelete={(id) => remove(id)}
        onPrint={() => window.print()}
      />

      {/* Filter bottom sheet (mobile only) */}
      {showFilterSheet && (
        <FilterSheet
          filter={filter}
          orderType={orderType}
          onChangeFilter={setFilter}
          onChangeOrderType={setOrderType}
          onClose={() => setShowFilterSheet(false)}
          activeCount={activeFilterCount}
        />
      )}

      {/* Shared "New Order" form (both desktop and mobile) */}
      {showNew && (
        <div className="max-w-6xl mx-auto p-3 md:p-6">
          <NewOrderForm
            onClose={() => setShowNew(false)}
            onSaved={() => {
              refetch();
              qc.invalidateQueries({ queryKey: ['orders-report'] });
            }}
          />
        </div>
      )}

      {/* Shared modals (both desktop and mobile) */}
      {paymentsOrder && (
        <PaymentsModal
          order={paymentsOrder}
          onClose={() => setPaymentsOrder(null)}
          onChanged={() => safeRefresh()}
        />
      )}

      {editingOrder && (
        <EditOrderMetaModal
          order={editingOrder}
          onClose={() => setEditingOrder(null)}
          onSaved={() => { setEditingOrder(null); safeRefresh(); }}
        />
      )}
    </AppShell>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MOBILE ORDERS (< md) — new professional layout.
   - Sticky header with title + smart count + FAB.
   - Persistent search bar + filter button (badge counter).
   - Horizontal KPI ribbon (same 4 metrics as desktop).
   - Rich order cards preserving every column and every action:
     view customer, payments log, add payment, edit, print, delete.
   Print uses the same window.print() flow (desktop print stylesheet
   remains authoritative — mobile card cluster hides on print).
═══════════════════════════════════════════════════════════════════ */
function MobileOrders({
  orders, report, search, onSearch,
  filter, orderType, activeFilterCount,
  onOpenFilters, onNewOrder, onOpenPayments,
  onEdit, onDelete, onPrint,
}: {
  orders: any[] | undefined;
  report: any;
  search: string;
  onSearch: (v: string) => void;
  filter: string;
  orderType: string;
  activeFilterCount: number;
  onOpenFilters: () => void;
  onNewOrder: () => void;
  onOpenPayments: (o: any) => void;
  onEdit: (o: any) => void;
  onDelete: (id: string) => void;
  onPrint: () => void;
}) {
  const totalCount = orders?.length ?? 0;
  const unpaidCount = (orders ?? []).filter((o: any) => Number(o.balance ?? 0) > 0).length;

  return (
    <div className="md:hidden print:hidden" dir="rtl">
      {/* Sticky header */}
      <div className="sticky top-0 z-20 bg-zinc-50/95 backdrop-blur border-b border-zinc-200 px-3 pt-3 pb-2">
        <div className="flex items-center justify-between mb-2">
          <div className="min-w-0">
            <h1 className="text-xl font-black tracking-tight leading-tight">الطلبيات</h1>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              {totalCount} طلبية{unpaidCount > 0 ? ` · ${unpaidCount} غير مدفوعة` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onNewOrder}
            aria-label="طلبية جديدة"
            className="w-11 h-11 rounded-full bg-zinc-900 text-white flex items-center justify-center active:scale-95 transition-transform shadow-md"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="بحث بالعميل، الهاتف، رقم الشحنة…"
              className="w-full h-11 pr-9 pl-3 rounded-xl border border-zinc-200 bg-white text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
            />
          </div>
          <button
            type="button"
            onClick={onOpenFilters}
            aria-label={`فلترة${activeFilterCount > 0 ? ` (${activeFilterCount} مفعّلة)` : ''}`}
            className={cn(
              'relative h-11 min-w-[44px] px-3 rounded-xl flex items-center justify-center gap-1.5 text-sm font-bold active:scale-95 transition-transform',
              activeFilterCount > 0
                ? 'bg-zinc-900 text-white'
                : 'bg-white border border-zinc-200 text-zinc-700',
            )}
          >
            <SlidersHorizontal className="h-4 w-4" />
            <span>فلترة</span>
            {activeFilterCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-amber-500 text-white text-[10px] font-black flex items-center justify-center px-1">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="px-3 pt-3 pb-4 space-y-3">
        {/* KPI ribbon — horizontal snap-scroll */}
        <div
          className="flex gap-2 overflow-x-auto -mx-3 px-3 pb-1 [&::-webkit-scrollbar]:hidden"
          style={{ scrollbarWidth: 'none' }}
          role="region"
          aria-label="مؤشرات الطلبيات"
        >
          <KpiChip label="الإجمالي" value={fmt2(report?.totalAmount ?? 0)} tone="neutral" unit="د.أ" />
          <KpiChip label="المسدد"   value={fmt2(report?.totalPaid ?? 0)}   tone="good"    unit="د.أ" />
          <KpiChip label="المتبقي"  value={fmt2(report?.totalBalance ?? 0)} tone={(report?.totalBalance ?? 0) > 0 ? 'warn' : 'neutral'} unit="د.أ" />
          <KpiChip label="طلبيات"   value={String(report?.ordersCount ?? totalCount)} tone="neutral" />
        </div>

        {/* Active filter chips (quick-remove) */}
        {activeFilterCount > 0 && (
          <div className="flex flex-wrap gap-2">
            {orderType && (
              <ActiveChip label={orderType === 'INTERNAL' ? 'داخلية' : 'خارجية'} />
            )}
            {filter && (
              <ActiveChip
                label={
                  filter === 'PAID'    ? 'مدفوع كامل' :
                  filter === 'PARTIAL' ? 'مدفوع جزئي' :
                                         'غير مدفوع'
                }
              />
            )}
          </div>
        )}

        {/* Cards / empty state */}
        {!orders || orders.length === 0 ? (
          <div className="bg-white rounded-2xl border border-zinc-200 py-14 text-center">
            <ShoppingCart className="h-10 w-10 mx-auto text-zinc-300 mb-3" />
            <p className="text-sm text-zinc-500">لا توجد طلبيات مطابقة</p>
          </div>
        ) : (
          orders.map((o: any) => (
            <MobileOrderCard
              key={`m-${o.id}`}
              o={o}
              onOpenPayments={onOpenPayments}
              onEdit={onEdit}
              onDelete={onDelete}
              onPrint={onPrint}
            />
          ))
        )}
      </div>
    </div>
  );
}

function fmt2(n: number | string) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function KpiChip({
  label, value, tone = 'neutral', unit,
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'good' | 'warn';
  unit?: string;
}) {
  const valueClass =
    tone === 'good' ? 'text-emerald-700' :
    tone === 'warn' ? 'text-amber-700' :
    'text-zinc-900';
  return (
    <div className="flex-shrink-0 bg-white border border-zinc-200 rounded-xl px-3 py-2 min-w-[112px]">
      <div className="text-[10px] text-zinc-500">{label}</div>
      <div className={cn('font-black text-base mt-0.5 leading-none', valueClass)} data-numeric>
        {value}
        {unit && <span className="text-[10px] font-bold text-zinc-400 mr-1">{unit}</span>}
      </div>
    </div>
  );
}

function ActiveChip({ label }: { label: string }) {
  return (
    <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-zinc-900 text-white flex items-center gap-1">
      {label}
    </span>
  );
}

function MobileOrderCard({
  o, onOpenPayments, onEdit, onDelete, onPrint,
}: {
  o: any;
  onOpenPayments: (o: any) => void;
  onEdit: (o: any) => void;
  onDelete: (id: string) => void;
  onPrint: () => void;
}) {
  const isExternal = o.orderType === 'EXTERNAL';
  const total = Number(o.total ?? 0);
  const paid = Number(o.paid ?? 0);
  const balance = Number(o.balance ?? 0);
  const hasBalance = balance > 0;

  // Ton fields — surface only when meaningful (external or ton lines).
  const lines = o.lines ?? [];
  const tonsQty = lines
    .filter((l: any) => String(l.unit || '').toUpperCase() === 'TON')
    .reduce((s: number, l: any) => s + Number(l.quantity || 0), 0);
  const showTonBlock = isExternal || tonsQty > 0;

  return (
    <div
      className="bg-white rounded-2xl border border-zinc-200 p-3.5"
      style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}
    >
      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] text-zinc-500">{o.number}</span>
        <div className="flex gap-1.5">
          <TypePill isExternal={isExternal} />
          <StatusPill status={o.status} />
        </div>
      </div>

      {/* Customer */}
      <div className="mt-2">
        {o.customerId ? (
          <a
            href={`/customers/${o.customerId}`}
            className="text-[15px] font-bold text-zinc-900 underline-offset-2 hover:underline"
          >
            {o.customerName || '—'}
          </a>
        ) : (
          <span className="text-[15px] font-bold text-zinc-900">{o.customerName || '—'}</span>
        )}
      </div>

      {/* Meta rows — every desktop field, condensed */}
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-600">
        {o.customerPhone && (
          <span className="inline-flex items-center gap-1">
            <Phone className="h-3 w-3 text-zinc-400" /> {o.customerPhone}
          </span>
        )}
        {o.region && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3 w-3 text-zinc-400" /> {o.region}
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <Receipt className="h-3 w-3 text-zinc-400" /> {formatDate(o.orderDate)}
        </span>
        {isExternal && o.deliveryLocation && (
          <span className="inline-flex items-center gap-1">
            <Building2 className="h-3 w-3 text-zinc-400" /> {o.deliveryLocation}
          </span>
        )}
        {isExternal && o.shipmentTrackingNumber && (
          <span className="inline-flex items-center gap-1 font-mono">
            <Truck className="h-3 w-3 text-zinc-400" /> {o.shipmentTrackingNumber}
          </span>
        )}
        {isExternal && o.expectedShippingDate && (
          <span className="inline-flex items-center gap-1">
            شحن: {formatDate(o.expectedShippingDate)}
          </span>
        )}
        {isExternal && o.expectedArrivalDate && (
          <span className="inline-flex items-center gap-1">
            وصول: {formatDate(o.expectedArrivalDate)}
          </span>
        )}
      </div>

      {/* Ton block — only when relevant */}
      {showTonBlock && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-sky-700 bg-sky-50/50 border border-sky-100 rounded-lg px-2 py-1.5">
          {tonsQty > 0 && <span data-numeric>الطن: <b>{fmt2(tonsQty)}</b></span>}
          {o.tonPrice != null && <span data-numeric>سعر الطن: <b>{fmt2(o.tonPrice)}</b></span>}
          {Number(o.productsTotal ?? 0) > 0 && (
            <span data-numeric>إجمالي البضاعة: <b>{fmt2(o.productsTotal)}</b></span>
          )}
          {Number(o.shippingCost ?? 0) > 0 && (
            <span data-numeric>أجور الشحن: <b>{fmt2(o.shippingCost)}</b></span>
          )}
        </div>
      )}

      {/* Money block */}
      <div className="mt-3 pt-3 border-t border-dashed border-zinc-200 grid grid-cols-3 gap-2">
        <MoneyBlock label="الإجمالي" value={fmt2(total)} bold />
        <MoneyBlock label="المسدد" value={fmt2(paid)} tone="good" />
        <MoneyBlock label="المتبقي" value={fmt2(balance)} tone={hasBalance ? 'warn' : 'neutral'} />
      </div>

      {/* Actions — every desktop action preserved */}
      <div className="mt-3 flex gap-1.5">
        {hasBalance && (
          <button
            type="button"
            onClick={() => onOpenPayments(o)}
            className="flex-1 min-h-[38px] rounded-xl bg-emerald-50 text-emerald-800 text-xs font-bold flex items-center justify-center gap-1.5 active:bg-emerald-100"
          >
            <Wallet className="h-3.5 w-3.5" /> دفعة
          </button>
        )}
        <button
          type="button"
          onClick={() => onOpenPayments(o)}
          className={cn(
            'min-h-[38px] rounded-xl bg-zinc-100 text-zinc-800 text-xs font-bold flex items-center justify-center gap-1.5 active:bg-zinc-200',
            hasBalance ? 'flex-1' : 'flex-[2]',
          )}
        >
          <Receipt className="h-3.5 w-3.5" /> دفعات
        </button>
        <button
          type="button"
          onClick={() => onEdit(o)}
          className="flex-1 min-h-[38px] rounded-xl bg-blue-50 text-blue-800 text-xs font-bold flex items-center justify-center gap-1.5 active:bg-blue-100"
        >
          <Pencil className="h-3.5 w-3.5" /> تعديل
        </button>
        <button
          type="button"
          onClick={onPrint}
          aria-label="طباعة"
          className="min-h-[38px] w-11 rounded-xl bg-zinc-50 text-zinc-600 flex items-center justify-center active:bg-zinc-100"
        >
          <Printer className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onDelete(o.id)}
          aria-label="حذف"
          className="min-h-[38px] w-11 rounded-xl bg-white text-red-600 border border-red-100 flex items-center justify-center active:bg-red-50"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function TypePill({ isExternal }: { isExternal: boolean }) {
  return (
    <span
      className={cn(
        'text-[10px] px-2 py-0.5 rounded-md font-bold',
        isExternal ? 'bg-blue-50 text-blue-800' : 'bg-zinc-100 text-zinc-700',
      )}
    >
      {isExternal ? 'خارجية' : 'داخلية'}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    PAID:    { bg: 'bg-emerald-100', fg: 'text-emerald-800', label: 'مدفوع' },
    PARTIAL: { bg: 'bg-amber-100',   fg: 'text-amber-800',   label: 'جزئي' },
    UNPAID:  { bg: 'bg-red-100',     fg: 'text-red-800',     label: 'غير مدفوع' },
  };
  const s = map[status] ?? map.UNPAID;
  return (
    <span className={cn('text-[10px] px-2 py-0.5 rounded-md font-bold', s.bg, s.fg)}>
      {s.label}
    </span>
  );
}

function MoneyBlock({
  label, value, tone = 'neutral', bold,
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'good' | 'warn';
  bold?: boolean;
}) {
  const cls =
    tone === 'good' ? 'text-emerald-700' :
    tone === 'warn' ? 'text-amber-700' :
    'text-zinc-900';
  return (
    <div>
      <div className="text-[10px] text-zinc-500">{label}</div>
      <div className={cn('mt-0.5 leading-none', cls, bold ? 'text-[15px] font-black' : 'text-[13px] font-bold')} data-numeric>
        {value}
      </div>
    </div>
  );
}

/* ─── Mobile filter bottom sheet ───────────────────────── */
function FilterSheet({
  filter, orderType, onChangeFilter, onChangeOrderType, onClose, activeCount,
}: {
  filter: string;
  orderType: string;
  onChangeFilter: (v: string) => void;
  onChangeOrderType: (v: string) => void;
  onClose: () => void;
  activeCount: number;
}) {
  // Local draft — apply on "Apply", cancel on backdrop close.
  const [localFilter, setLocalFilter] = useState(filter);
  const [localType, setLocalType] = useState(orderType);
  const draftCount = (localFilter ? 1 : 0) + (localType ? 1 : 0);

  return (
    <div
      className="md:hidden fixed inset-0 z-50 flex items-end"
      role="dialog"
      aria-modal="true"
      aria-label="فلترة الطلبيات"
      dir="rtl"
    >
      <div
        className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className="relative w-full max-h-[85vh] bg-white rounded-t-2xl flex flex-col shadow-2xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="pt-2 pb-1 flex justify-center">
          <div className="h-1 w-10 rounded-full bg-zinc-300" />
        </div>
        <div className="px-4 py-2.5 flex items-center justify-between border-b border-zinc-100">
          <div>
            <div className="text-sm font-bold text-zinc-900">فلترة الطلبيات</div>
            <div className="text-[10px] text-zinc-500 mt-0.5">
              {activeCount > 0 ? `${activeCount} فلاتر مفعّلة حالياً` : 'لا يوجد فلاتر مفعّلة'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-zinc-100 active:bg-zinc-200"
          >
            <X className="h-5 w-5 text-zinc-700" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Order type */}
          <div className="px-4 pt-4">
            <div className="text-[11px] text-zinc-500 font-bold mb-2">نوع الطلبية</div>
            <div className="grid grid-cols-3 gap-2">
              <FilterOpt label="الكل" active={localType === ''} onClick={() => setLocalType('')} />
              <FilterOpt label="داخلية" icon={<Building2 className="h-3.5 w-3.5" />} active={localType === 'INTERNAL'} onClick={() => setLocalType('INTERNAL')} />
              <FilterOpt label="خارجية" icon={<Truck className="h-3.5 w-3.5" />} active={localType === 'EXTERNAL'} onClick={() => setLocalType('EXTERNAL')} />
            </div>
          </div>

          {/* Payment status */}
          <div className="px-4 pt-5 pb-4">
            <div className="text-[11px] text-zinc-500 font-bold mb-2">حالة الدفع</div>
            <div className="grid grid-cols-2 gap-2">
              <FilterOpt label="الكل" active={localFilter === ''} onClick={() => setLocalFilter('')} />
              <FilterOpt label="غير مدفوع" tone="danger" active={localFilter === 'UNPAID'} onClick={() => setLocalFilter('UNPAID')} />
              <FilterOpt label="مدفوع جزئي" tone="warn" active={localFilter === 'PARTIAL'} onClick={() => setLocalFilter('PARTIAL')} />
              <FilterOpt label="مدفوع كامل" tone="good" active={localFilter === 'PAID'} onClick={() => setLocalFilter('PAID')} />
            </div>
          </div>
        </div>

        <div className="border-t border-zinc-100 p-3 flex gap-2">
          <button
            type="button"
            onClick={() => { setLocalFilter(''); setLocalType(''); }}
            className="flex-1 min-h-[44px] rounded-xl bg-zinc-100 text-zinc-800 text-sm font-bold active:bg-zinc-200"
          >
            إعادة
          </button>
          <button
            type="button"
            onClick={() => {
              onChangeFilter(localFilter);
              onChangeOrderType(localType);
              onClose();
            }}
            className="flex-[2] min-h-[44px] rounded-xl bg-zinc-900 text-white text-sm font-bold active:opacity-90 flex items-center justify-center gap-1"
          >
            <Check className="h-4 w-4" />
            {draftCount === 0 ? 'إظهار الكل' : `تطبيق ${draftCount} فلاتر`}
          </button>
        </div>
      </div>
    </div>
  );
}

function FilterOpt({
  label, active, onClick, tone, icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  tone?: 'good' | 'warn' | 'danger';
  icon?: React.ReactNode;
}) {
  const activeCls =
    !active ? 'bg-zinc-100 text-zinc-800' :
    tone === 'good'   ? 'bg-emerald-600 text-white' :
    tone === 'warn'   ? 'bg-amber-500 text-white' :
    tone === 'danger' ? 'bg-red-600 text-white' :
    'bg-zinc-900 text-white';
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'min-h-[44px] rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 transition-colors',
        activeCls,
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// ─── Modal لتعديل بيانات الطلبية العلوية (النوع + الشحن + العقد) ─
function EditOrderMetaModal({
  order,
  onClose,
  onSaved,
}: {
  order: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const toDate = (v: any) => (v ? new Date(v).toISOString().slice(0, 10) : '');
  const [form, setForm] = useState({
    orderType: order.orderType ?? 'INTERNAL',
    customerName: order.customerName ?? '',
    customerPhone: order.customerPhone ?? '',
    region: order.region ?? '',
    contractNumber: order.contractNumber ?? '',
    deliveryLocation: order.deliveryLocation ?? '',
    expectedShippingDate: toDate(order.expectedShippingDate),
    expectedArrivalDate: toDate(order.expectedArrivalDate),
    shipmentTrackingNumber: order.shipmentTrackingNumber ?? '',
    notes: order.notes ?? '',
    tonPrice: order.tonPrice != null ? String(order.tonPrice) : '',
    shippingCost: order.shippingCost != null ? String(order.shippingCost) : '',
  });
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/orders/${order.id}/meta`, {
        ...form,
        expectedShippingDate: form.expectedShippingDate || undefined,
        expectedArrivalDate: form.expectedArrivalDate || undefined,
        tonPrice: form.tonPrice ? Number(form.tonPrice) : null,
        shippingCost: form.shippingCost ? Number(form.shippingCost) : 0,
      });
      toast.success('تم تحديث بيانات الطلبية');
      onSaved();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-zinc-100 sticky top-0 bg-white">
          <div>
            <h3 className="font-bold flex items-center gap-2">
              <Pencil className="h-5 w-5" /> تعديل الطلبية {order.number}
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">{order.customerName}</p>
          </div>
          <button onClick={onClose}><X className="h-5 w-5 text-zinc-400" /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div className="flex gap-2 flex-wrap">
            <label className="text-xs font-bold text-zinc-700 w-full">نوع الطلبية</label>
            {[
              { v: 'INTERNAL', l: 'داخلية' },
              { v: 'EXTERNAL', l: 'خارجية' },
            ].map((t) => (
              <button
                key={t.v}
                type="button"
                onClick={() => setForm({ ...form, orderType: t.v })}
                className={cn(
                  'px-4 py-2 rounded-lg text-sm font-bold border',
                  form.orderType === t.v
                    ? 'bg-zinc-900 text-white border-zinc-900'
                    : 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50',
                )}
              >
                {t.l}
              </button>
            ))}
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <Input label="اسم العميل" value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} />
            <Input label="الهاتف" value={form.customerPhone} onChange={(e) => setForm({ ...form, customerPhone: e.target.value })} />
            <Input label="المنطقة" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} />
            <Input label="رقم العقد" value={form.contractNumber} onChange={(e) => setForm({ ...form, contractNumber: e.target.value })} />
            <Input label="موقع التسليم" value={form.deliveryLocation} onChange={(e) => setForm({ ...form, deliveryLocation: e.target.value })} />
            <Input label="رقم الشحنة" value={form.shipmentTrackingNumber} onChange={(e) => setForm({ ...form, shipmentTrackingNumber: e.target.value })} />
            <Input label="تاريخ الشحن المتوقع" type="date" value={form.expectedShippingDate} onChange={(e) => setForm({ ...form, expectedShippingDate: e.target.value })} />
            <Input label="تاريخ الوصول المتوقع" type="date" value={form.expectedArrivalDate} onChange={(e) => setForm({ ...form, expectedArrivalDate: e.target.value })} />
            <Input label="سعر الطن (د.أ)" type="number" step="0.01" value={form.tonPrice} onChange={(e) => setForm({ ...form, tonPrice: e.target.value })} />
            <Input label="أجور الشحن (د.أ)" type="number" step="0.01" value={form.shippingCost} onChange={(e) => setForm({ ...form, shippingCost: e.target.value })} />
          </div>
          <Input label="ملاحظات" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <div className="rounded-lg bg-amber-50 border border-amber-100 p-3 text-xs text-amber-800">
            ملاحظة: هذا التعديل لا يمس بنود الطلبية (المنتجات والكميات). لتعديلها استخدم زر الدفعات ثم اطلب تعديلاً كاملاً.
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={onClose}>إلغاء</Button>
            <Button type="submit" loading={saving}>حفظ التعديل</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Modal الدفعات (جدول دفعات + نموذج إضافة) ───────────
function PaymentsModal({
  order,
  onClose,
  onChanged,
}: {
  order: any;
  onClose: () => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ amount: '', method: 'CASH', notes: '' });
  const [allowOverpay, setAllowOverpay] = useState(false);

  const key = ['order-payments', order.id];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api.get(`/orders/${order.id}/payments`).then((r) => r.data),
  });

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ['order-payments', order.id] });
    onChanged();
  };

  const add = useMutation({
    mutationFn: (body: any) => api.post(`/orders/${order.id}/pay`, body).then((r) => r.data),
    onSuccess: () => {
      toast.success('تم تسجيل الدفعة');
      setForm({ amount: '', method: 'CASH', notes: '' });
      setAllowOverpay(false);
      refreshAll();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'تعذّر تسجيل الدفعة'),
  });

  const del = useMutation({
    mutationFn: (paymentId: string) =>
      api.delete(`/orders/payments/${paymentId}`).then((r) => r.data),
    onSuccess: () => {
      toast.success('تم حذف الدفعة');
      refreshAll();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'تعذّر الحذف'),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(form.amount);
    if (isNaN(amt) || amt <= 0) return toast.error('مبلغ غير صحيح');
    add.mutate({ amount: amt, method: form.method, notes: form.notes || undefined, allowOverpay });
  };

  const total = data?.total ?? Number(order.total);
  const paid = data?.totalPaid ?? Number(order.paid);
  const balance = data?.balance ?? Number(order.balance);
  const status = data?.status ?? order.status;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-zinc-100 sticky top-0 bg-white">
          <div>
            <h3 className="font-bold flex items-center gap-2">
              <Receipt className="h-5 w-5" /> دفعات الطلبية — {order.number}
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">{order.customerName}</p>
          </div>
          <button onClick={onClose}><X className="h-5 w-5 text-zinc-400" /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* ملخص واضح */}
          <div className="grid grid-cols-4 gap-2">
            <div className="rounded-lg bg-zinc-50 border border-zinc-100 p-3">
              <div className="text-[10px] font-bold text-zinc-500 uppercase">إجمالي</div>
              <div className="text-lg font-black mt-1" data-numeric>{Number(total).toFixed(2)}</div>
            </div>
            <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-3">
              <div className="text-[10px] font-bold text-emerald-700 uppercase">المدفوع</div>
              <div className="text-lg font-black mt-1 text-emerald-700" data-numeric>{Number(paid).toFixed(2)}</div>
            </div>
            <div className={cn('rounded-lg border p-3', balance > 0 ? 'bg-amber-50 border-amber-100' : 'bg-zinc-50 border-zinc-100')}>
              <div className={cn('text-[10px] font-bold uppercase', balance > 0 ? 'text-amber-700' : 'text-zinc-500')}>المتبقي</div>
              <div className={cn('text-lg font-black mt-1', balance > 0 ? 'text-amber-700' : 'text-zinc-500')} data-numeric>{Number(balance).toFixed(2)}</div>
            </div>
            <div className="rounded-lg bg-white border border-zinc-200 p-3 flex flex-col items-start">
              <div className="text-[10px] font-bold text-zinc-500 uppercase">الحالة</div>
              <div className="mt-2">
                {status === 'PAID' ? <Badge variant="success" dot>مدفوع</Badge>
                : status === 'PARTIAL' ? <Badge variant="warning" dot>جزئي</Badge>
                : <Badge variant="danger" dot>غير مدفوع</Badge>}
              </div>
            </div>
          </div>

          {/* نموذج إضافة دفعة */}
          {balance > 0 || allowOverpay ? (
            <form onSubmit={submit} className="grid grid-cols-12 gap-2 rounded-xl bg-zinc-50 border border-zinc-100 p-3">
              <div className="col-span-3">
                <label className="text-[10px] font-bold text-zinc-500 uppercase">المبلغ</label>
                <input
                  type="number" step="0.01"
                  value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm mt-1"
                  placeholder={balance > 0 ? balance.toFixed(2) : '0.00'}
                />
              </div>
              <div className="col-span-3">
                <label className="text-[10px] font-bold text-zinc-500 uppercase">الطريقة</label>
                <select
                  value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}
                  className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm mt-1"
                >
                  {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div className="col-span-4">
                <label className="text-[10px] font-bold text-zinc-500 uppercase">ملاحظة</label>
                <input
                  value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm mt-1"
                  placeholder="اختياري"
                />
              </div>
              <div className="col-span-2 flex items-end">
                <Button type="submit" className="w-full" loading={add.isPending}>
                  <Plus className="h-4 w-4" /> إضافة
                </Button>
              </div>
              <div className="col-span-12">
                <label className="inline-flex items-center gap-2 text-xs text-zinc-600">
                  <input type="checkbox" checked={allowOverpay} onChange={(e) => setAllowOverpay(e.target.checked)} />
                  السماح بتسجيل دفعة زائدة عن المبلغ الكلي (رصيد للعميل)
                </label>
              </div>
              {/* ─── معاينة لحظية للأرقام قبل التأكيد ─ */}
              {(() => {
                const newAmt = parseFloat(form.amount || '0') || 0;
                if (newAmt <= 0) return null;
                const updatedPaid = Number(paid) + newAmt;
                const updatedBalance = Math.max(0, Number(total) - updatedPaid);
                const over = updatedPaid > Number(total);
                return (
                  <div className="col-span-12 rounded-lg bg-white border border-zinc-200 p-3 grid grid-cols-5 gap-2 text-[11px]">
                    <div><div className="text-zinc-500">إجمالي الطلبية</div><div className="font-bold" data-numeric>{Number(total).toFixed(2)}</div></div>
                    <div><div className="text-zinc-500">مدفوع سابق</div><div className="font-bold" data-numeric>{Number(paid).toFixed(2)}</div></div>
                    <div><div className="text-zinc-500">هذه الدفعة</div><div className="font-bold text-blue-700" data-numeric>+ {newAmt.toFixed(2)}</div></div>
                    <div><div className="text-zinc-500">المدفوع بعد</div><div className="font-bold text-emerald-700" data-numeric>{updatedPaid.toFixed(2)}</div></div>
                    <div><div className={cn('text-zinc-500', over && 'text-red-600')}>المتبقي بعد</div><div className={cn('font-bold', updatedBalance > 0 ? 'text-amber-600' : 'text-zinc-500')} data-numeric>{updatedBalance.toFixed(2)}</div></div>
                    {over && !allowOverpay && (
                      <div className="col-span-5 text-red-600 text-[11px] mt-1">⚠️ الدفعة تتجاوز الإجمالي — فعّل «السماح بدفعة زائدة» أولاً.</div>
                    )}
                  </div>
                );
              })()}
            </form>
          ) : (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-sm text-emerald-800 text-center">
              ✓ هذه الطلبية مدفوعة بالكامل. فعّل خيار «السماح بدفعة زائدة» إن أردت تسجيل رصيد إضافي.
              <div className="mt-2">
                <button onClick={() => setAllowOverpay(true)} className="text-xs text-emerald-700 underline">تفعيل</button>
              </div>
            </div>
          )}

          {/* جدول الدفعات */}
          {isLoading ? (
            <p className="text-sm text-zinc-500 text-center py-4">جاري التحميل...</p>
          ) : !data?.payments || data.payments.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-4">لا يوجد دفعات بعد</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 border-b">
                  <tr>
                    <th className="text-right p-2 text-[10px] font-bold text-zinc-500 uppercase">#</th>
                    <th className="text-right p-2 text-[10px] font-bold text-zinc-500 uppercase">التاريخ</th>
                    <th className="text-right p-2 text-[10px] font-bold text-zinc-500 uppercase">المبلغ</th>
                    <th className="text-right p-2 text-[10px] font-bold text-zinc-500 uppercase">الطريقة</th>
                    <th className="text-right p-2 text-[10px] font-bold text-zinc-500 uppercase">ملاحظة</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.payments.map((p: any) => (
                    <tr key={p.id} className="border-b border-zinc-100">
                      <td className="p-2 font-mono text-xs">#{p.number}</td>
                      <td className="p-2 text-zinc-500">{formatDate(p.createdAt)}</td>
                      <td className="p-2 font-bold text-emerald-700" data-numeric>{Number(p.amount).toFixed(2)}</td>
                      <td className="p-2"><span className="text-[10px] font-bold px-2 py-0.5 rounded bg-zinc-100">{METHOD_LABEL[p.method] || p.method}</span></td>
                      <td className="p-2 text-zinc-600 text-xs">{p.notes || '—'}</td>
                      <td className="p-2">
                        <button
                          onClick={() => { if (confirm('حذف هذه الدفعة وإعادة حساب المتبقي؟')) del.mutate(p.id); }}
                          className="text-red-500 hover:text-red-700 p-1"
                          title="حذف"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NewOrderForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data: items } = useQuery({
    queryKey: ['items-active'],
    queryFn: () => api.get('/inventory/items').then((r) => r.data),
  });

  const [form, setForm] = useState({
    customerName: '',
    customerPhone: '',
    region: '',
    paid: 0,
    notes: '',
    orderType: 'INTERNAL' as 'INTERNAL' | 'EXTERNAL',
    contractNumber: '',
    deliveryLocation: '',
    expectedShippingDate: '',
    expectedArrivalDate: '',
    shipmentTrackingNumber: '',
    tonPrice: '',        // سعر الطن الافتراضي على مستوى الطلبية
    shippingCost: '',    // أجور الشحن
    // ─── العملة وسعر الصرف ───
    currency: 'JOD' as 'JOD' | 'USD',
    exchangeRate: '1',
  });
  const [lines, setLines] = useState<any[]>([
    { productName: '', size: '', quantity: 1, unitPrice: 0, itemId: '', unit: 'PCS', tonPrice: '' },
  ]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // إجمالي البضاعة = مجموع (كمية × (سعر الطن للسطر ?? سعر الطن للطلبية ?? unitPrice))
  const productsTotal = lines.reduce((s, l) => {
    const qty = Number(l.quantity || 0);
    const lineTon = l.tonPrice !== '' && l.tonPrice != null ? Number(l.tonPrice) : null;
    const orderTon = form.tonPrice !== '' ? Number(form.tonPrice) : null;
    const price = String(l.unit || '').toUpperCase() === 'TON'
      ? (lineTon ?? orderTon ?? Number(l.unitPrice || 0))
      : (lineTon ?? Number(l.unitPrice || 0) ?? orderTon ?? 0);
    return s + qty * price;
  }, 0);
  const shipping = Number(form.shippingCost || 0);
  const total = productsTotal + shipping;
  const balance = total - Number(form.paid || 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!form.customerName) {
      setErr('اسم العميل مطلوب');
      return;
    }
    if (lines.length === 0 || lines.some((l) => !l.productName)) {
      setErr('أضف منتج واحد على الأقل');
      return;
    }
    setSaving(true);
    try {
      await api.post('/orders', {
        ...form,
        expectedShippingDate: form.expectedShippingDate || undefined,
        expectedArrivalDate: form.expectedArrivalDate || undefined,
        contractNumber: form.contractNumber || undefined,
        deliveryLocation: form.deliveryLocation || undefined,
        shipmentTrackingNumber: form.shipmentTrackingNumber || undefined,
        tonPrice: form.tonPrice ? Number(form.tonPrice) : undefined,
        shippingCost: form.shippingCost ? Number(form.shippingCost) : 0,
        currency: form.currency,
        exchangeRate: Number(form.exchangeRate) || 1,
        lines: lines.map((l) => ({
          ...l,
          tonPrice: l.tonPrice ? Number(l.tonPrice) : undefined,
        })),
      });
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e?.response?.data?.message || 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex justify-between mb-4">
        <h3 className="font-bold text-lg">طلبية جديدة</h3>
        <button onClick={onClose}>
          <X className="h-5 w-5 text-zinc-400" />
        </button>
      </div>

      <form onSubmit={submit} className="space-y-4">
        {/* نوع الطلبية */}
        <div className="flex gap-2 flex-wrap">
          <label className="text-xs font-bold text-zinc-700 w-full">نوع الطلبية *</label>
          {[
            { v: 'INTERNAL', l: 'داخلية' },
            { v: 'EXTERNAL', l: 'خارجية' },
          ].map((t) => (
            <button
              key={t.v}
              type="button"
              onClick={() => setForm({ ...form, orderType: t.v as any })}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-bold border',
                form.orderType === t.v
                  ? 'bg-zinc-900 text-white border-zinc-900'
                  : 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50',
              )}
            >
              {t.l}
            </button>
          ))}
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <Input
            label="اسم العميل *"
            value={form.customerName}
            onChange={(e) => setForm({ ...form, customerName: e.target.value })}
            required
          />
          <Input
            label="رقم الهاتف"
            value={form.customerPhone}
            onChange={(e) => setForm({ ...form, customerPhone: e.target.value })}
          />
          <Input
            label="المنطقة"
            value={form.region}
            onChange={(e) => setForm({ ...form, region: e.target.value })}
          />
        </div>

        {/* حقول الشحن والعقد */}
        <Card className="p-4 bg-blue-50/50 border-blue-100">
          <h4 className="font-bold text-sm mb-3 flex items-center gap-2">
            <Truck className="h-4 w-4" /> بيانات الشحن والعقد
          </h4>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            <Input
              label="رقم العقد"
              value={form.contractNumber}
              onChange={(e) => setForm({ ...form, contractNumber: e.target.value })}
            />
            <Input
              label="موقع التسليم"
              value={form.deliveryLocation}
              onChange={(e) => setForm({ ...form, deliveryLocation: e.target.value })}
            />
            <Input
              label="رقم الشحنة (Tracking)"
              value={form.shipmentTrackingNumber}
              onChange={(e) => setForm({ ...form, shipmentTrackingNumber: e.target.value })}
            />
            <Input
              label="التاريخ المتوقع للشحن"
              type="date"
              value={form.expectedShippingDate}
              onChange={(e) => setForm({ ...form, expectedShippingDate: e.target.value })}
            />
            <Input
              label="التاريخ المتوقع للوصول"
              type="date"
              value={form.expectedArrivalDate}
              onChange={(e) => setForm({ ...form, expectedArrivalDate: e.target.value })}
            />
          </div>

          {/* ─── الحقول الجديدة: سعر الطن + أجور الشحن (للطلبيات الخارجية) ─ */}
          <div className="grid md:grid-cols-2 gap-3 mt-3">
            <Input
              label="سعر الطن — Ton Price"
              type="number"
              step="0.01"
              value={form.tonPrice}
              onChange={(e) => setForm({ ...form, tonPrice: e.target.value })}
              hint="افتراضي لجميع الأسطر ذات وحدة TON — يمكن تجاوزه لكل سطر"
            />
            <Input
              label="أجور الشحن — Shipping Cost"
              type="number"
              step="0.01"
              value={form.shippingCost}
              onChange={(e) => setForm({ ...form, shippingCost: e.target.value })}
              hint="يُضاف إلى إجمالي البضاعة لينتج الإجمالي النهائي"
            />
          </div>

          {/* ─── العملة وسعر الصرف ─ */}
          <div className="grid md:grid-cols-3 gap-3 mt-3">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-700 block">العملة *</label>
              <select
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value as any, exchangeRate: e.target.value === 'JOD' ? '1' : form.exchangeRate })}
                className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
              >
                <option value="JOD">الدينار الأردني (JOD)</option>
                <option value="USD">الدولار الأمريكي (USD)</option>
              </select>
            </div>
            <Input
              label="سعر الصرف (لكل 1 من العملة → JOD)"
              type="number"
              step="0.000001"
              value={form.exchangeRate}
              onChange={(e) => setForm({ ...form, exchangeRate: e.target.value })}
              disabled={form.currency === 'JOD'}
              hint={form.currency === 'USD' ? 'مثال: 0.709 يعني 1 USD = 0.709 JOD' : 'JOD = العملة الأساسية (1)'}
            />
            {form.currency !== 'JOD' && (
              <div className="rounded-lg bg-blue-50 border border-blue-100 p-2 text-xs text-blue-800 flex flex-col justify-center">
                <div className="font-bold">المكافئ بالـ JOD:</div>
                <div className="text-sm font-black mt-1">
                  {((productsTotal + Number(form.shippingCost || 0)) * (Number(form.exchangeRate) || 1)).toFixed(3)} د.أ
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Lines */}
        <Card className="p-4 bg-zinc-50">
          <div className="flex justify-between items-center mb-3">
            <h4 className="font-bold text-sm">المنتجات</h4>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                setLines([
                  ...lines,
                  { productName: '', size: '', quantity: 1, unitPrice: 0, itemId: '' },
                ])
              }
            >
              <Plus className="h-3.5 w-3.5" />
              إضافة
            </Button>
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid md:grid-cols-12 gap-2 items-center">
                <div className="md:col-span-4">
                  <select
                    value={l.itemId}
                    onChange={(e) => {
                      const v = [...lines];
                      const it = items?.find((x: any) => x.id === e.target.value);
                      v[i] = {
                        ...v[i],
                        itemId: e.target.value,
                        productName: it?.name ?? v[i].productName,
                        unitPrice: it?.sellPrice ? Number(it.sellPrice) : v[i].unitPrice,
                      };
                      setLines(v);
                    }}
                    className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm bg-white"
                  >
                    <option value="">— اختر من المخزون —</option>
                    {items?.map((it: any) => (
                      <option key={it.id} value={it.id}>
                        {it.name} ({it.totalStock} {it.unit})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-3">
                  <Input
                    placeholder="اسم المنتج"
                    value={l.productName}
                    onChange={(e) => {
                      const v = [...lines];
                      v[i] = { ...v[i], productName: e.target.value };
                      setLines(v);
                    }}
                  />
                </div>
                <div className="md:col-span-2">
                  <Input
                    label={i === 0 ? 'الكمية' : undefined}
                    type="number"
                    placeholder="الكمية"
                    value={l.quantity}
                    onChange={(e) => {
                      const v = [...lines];
                      v[i] = { ...v[i], quantity: +e.target.value };
                      setLines(v);
                    }}
                  />
                </div>
                <div className="md:col-span-2">
                  <Input
                    label={i === 0 ? 'السعر' : undefined}
                    type="number"
                    step="0.01"
                    placeholder="السعر"
                    value={l.unitPrice}
                    onChange={(e) => {
                      const v = [...lines];
                      v[i] = { ...v[i], unitPrice: +e.target.value };
                      setLines(v);
                    }}
                  />
                </div>
                <div className="md:col-span-1 flex items-center gap-1">
                  <span className="text-xs text-zinc-500" data-numeric>
                    {(() => {
                      const qty = Number(l.quantity || 0);
                      const lineTon = l.tonPrice !== '' && l.tonPrice != null ? Number(l.tonPrice) : null;
                      const orderTon = form.tonPrice !== '' ? Number(form.tonPrice) : null;
                      const price = String(l.unit || '').toUpperCase() === 'TON'
                        ? (lineTon ?? orderTon ?? Number(l.unitPrice || 0))
                        : (lineTon ?? Number(l.unitPrice || 0) ?? orderTon ?? 0);
                      return (qty * price).toFixed(2);
                    })()}
                  </span>
                  <button
                    type="button"
                    onClick={() => setLines(lines.filter((_, idx) => idx !== i))}
                    className="text-red-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {/* صف فرعي: الوحدة + سعر الطن (خاص بالسطر) */}
                <div className="md:col-span-12 grid md:grid-cols-4 gap-2 md:pr-4">
                  <select
                    value={l.unit ?? 'PCS'}
                    onChange={(e) => {
                      const v = [...lines];
                      v[i] = { ...v[i], unit: e.target.value };
                      setLines(v);
                    }}
                    className="h-9 px-2 rounded border border-zinc-200 text-xs bg-white"
                    title="الوحدة"
                  >
                    <option value="PCS">حبة / PCS</option>
                    <option value="CTN">كرتون</option>
                    <option value="KG">كيلوغرام</option>
                    <option value="TON">طن / TON</option>
                    <option value="BAG">شوال</option>
                    <option value="ROLL">رول</option>
                  </select>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="سعر الطن لهذا السطر (اختياري)"
                    value={l.tonPrice ?? ''}
                    onChange={(e) => {
                      const v = [...lines];
                      v[i] = { ...v[i], tonPrice: e.target.value };
                      setLines(v);
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Totals */}
        <div className="grid md:grid-cols-3 gap-4">
          <div className="rounded-xl border-2 border-zinc-200 bg-white p-4">
            <div className="text-xs text-zinc-500">الإجمالي</div>
            <div className="text-2xl font-black mt-1" data-numeric>
              {total.toFixed(2)} د.أ
            </div>
          </div>
          <Input
            label="المدفوع"
            type="number"
            step="0.01"
            value={form.paid}
            onChange={(e) => setForm({ ...form, paid: +e.target.value })}
          />
          <div
            className={cn(
              'rounded-xl border-2 p-4',
              balance > 0
                ? 'border-amber-200 bg-amber-50'
                : 'border-emerald-200 bg-emerald-50',
            )}
          >
            <div className="text-xs text-zinc-600">المتبقي</div>
            <div className="text-2xl font-black mt-1" data-numeric>
              {balance.toFixed(2)} د.أ
            </div>
          </div>
        </div>

        {err && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            {err}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit" loading={saving}>
            حفظ الطلبية
          </Button>
        </div>
      </form>
    </Card>
  );
}

/* ═════════════════════════════════════════════
   Helpers — بيانات الشحن في جدول الطلبيات
════════════════════════════════════════════ */

// موقع التسليم — يُقصر بصرياً ويعرض القيمة الكاملة في tooltip
function LocationCell({ value, isExternal }: { value?: string | null; isExternal: boolean }) {
  if (!isExternal) return <span className="text-zinc-400">—</span>;
  if (!value) return <span className="text-zinc-400">—</span>;
  return (
    <span
      className="block truncate max-w-[180px] cursor-help"
      title={value}
    >
      {value}
    </span>
  );
}

// رقم الشحنة — قابل للنسخ بضغطة واحدة + مؤشر نجاح لحظي
function TrackingCell({ value, isExternal }: { value?: string | null; isExternal: boolean }) {
  const [copied, setCopied] = useState(false);
  if (!isExternal) return <span className="text-zinc-400">—</span>;
  if (!value) return <span className="text-zinc-400">—</span>;
  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* المتصفح لا يدعم — تجاهل */
    }
  };
  return (
    <span className="inline-flex items-center gap-1 font-mono text-xs">
      <span title={value}>{value}</span>
      <button
        type="button"
        onClick={doCopy}
        className={cn(
          'p-1 rounded transition-colors',
          copied ? 'text-emerald-600' : 'text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100',
        )}
        title="نسخ رقم الشحنة"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </button>
    </span>
  );
}

// حقل داخل بطاقة الموبايل
function MobileField({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-zinc-400 font-bold uppercase">{label}</div>
      <div className={cn('text-zinc-800', mono && 'font-mono text-[11px]')}>{value}</div>
    </div>
  );
}
