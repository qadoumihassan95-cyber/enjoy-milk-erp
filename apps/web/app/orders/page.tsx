'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Trash2, X, ShoppingCart, Phone, MapPin, Wallet, Receipt, Printer, Pencil, Building2, Truck } from 'lucide-react';
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
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6 print:p-2 print:space-y-2">
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

        {showNew && (
          <NewOrderForm
            onClose={() => setShowNew(false)}
            onSaved={() => {
              refetch();
              qc.invalidateQueries({ queryKey: ['orders-report'] });
            }}
          />
        )}

        {/* Orders list */}
        <Card>
          {!orders || orders.length === 0 ? (
            <div className="p-12 text-center">
              <ShoppingCart className="h-12 w-12 mx-auto text-zinc-300 mb-3" />
              <p className="text-zinc-500">لا توجد طلبيات</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 border-b">
                  <tr>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">رقم</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">النوع</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">العميل</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">الهاتف</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">المنطقة</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">التاريخ</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">الإجمالي</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">المدفوع</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">المتبقي</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">الحالة</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase print:hidden">إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o: any) => (
                    <tr key={o.id} className="border-b border-zinc-100 hover:bg-zinc-50">
                      <td className="p-3 font-mono text-xs">{o.number}</td>
                      <td className="p-3">
                        {o.orderType === 'EXTERNAL' ? (
                          <Badge variant="info" dot>خارجية</Badge>
                        ) : (
                          <Badge variant="default" dot>داخلية</Badge>
                        )}
                      </td>
                      <td className="p-3 font-medium">
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
                      <td className="p-3 text-zinc-600">{o.customerPhone || '-'}</td>
                      <td className="p-3 text-zinc-600">{o.region || '-'}</td>
                      <td className="p-3 text-zinc-600">{formatDate(o.orderDate)}</td>
                      <td className="p-3 font-bold" data-numeric>
                        {Number(o.total).toFixed(2)}
                      </td>
                      <td className="p-3 text-emerald-700" data-numeric>
                        {Number(o.paid).toFixed(2)}
                      </td>
                      <td
                        className={cn(
                          'p-3 font-bold',
                          Number(o.balance) > 0 ? 'text-amber-600' : 'text-zinc-500',
                        )}
                        data-numeric
                      >
                        {Number(o.balance).toFixed(2)}
                      </td>
                      <td className="p-3">
                        {o.status === 'PAID' ? (
                          <Badge variant="success" dot>مدفوع</Badge>
                        ) : o.status === 'PARTIAL' ? (
                          <Badge variant="warning" dot>جزئي</Badge>
                        ) : (
                          <Badge variant="danger" dot>غير مدفوع</Badge>
                        )}
                      </td>
                      <td className="p-3 flex gap-1 print:hidden">
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
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

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
      </div>
    </AppShell>
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
  });
  const [lines, setLines] = useState<any[]>([
    { productName: '', size: '', quantity: 1, unitPrice: 0, itemId: '' },
  ]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const total = lines.reduce(
    (s, l) => s + Number(l.quantity || 0) * Number(l.unitPrice || 0),
    0,
  );
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
        lines,
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
                    {(l.quantity * l.unitPrice).toFixed(2)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setLines(lines.filter((_, idx) => idx !== i))}
                    className="text-red-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
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
