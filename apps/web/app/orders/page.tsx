'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Trash2, X, ShoppingCart, Phone, MapPin } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, Button, Input, Badge, Stat } from '@/components/ui';
import { api } from '@/lib/api';
import { formatCurrency, formatDate, cn } from '@/lib/utils';

export default function OrdersPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);

  const { data: orders, refetch } = useQuery({
    queryKey: ['orders', filter, search],
    queryFn: () =>
      api
        .get('/orders', { params: { status: filter || undefined, search: search || undefined } })
        .then((r) => r.data),
  });

  const { data: report } = useQuery({
    queryKey: ['orders-report'],
    queryFn: () => api.get('/orders/report').then((r) => r.data),
  });

  const addPayment = async (orderId: string) => {
    const v = prompt('أدخل المبلغ المدفوع:');
    if (!v) return;
    try {
      await api.post(`/orders/${orderId}/pay`, { amount: +v });
      await refetch();
      qc.invalidateQueries({ queryKey: ['orders-report'] });
    } catch (e: any) {
      alert(e?.response?.data?.message || 'فشل');
    }
  };

  const remove = async (orderId: string) => {
    if (!confirm('سيتم إرجاع الكمية للمخزون. حذف الطلبية؟')) return;
    try {
      await api.delete(`/orders/${orderId}`);
      await refetch();
      qc.invalidateQueries({ queryKey: ['orders-report'] });
    } catch (e: any) {
      alert(e?.response?.data?.message || 'فشل الحذف');
    }
  };

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight">الطلبيات</h1>
            <p className="text-sm text-zinc-500 mt-0.5">
              {orders?.length ?? 0} طلبية
            </p>
          </div>
          <Button onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4" />
            طلبية جديدة
          </Button>
        </header>

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

        {/* Filters */}
        <Card className="p-3 flex flex-wrap gap-3 items-center">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <Input
              placeholder="بحث بالعميل أو الهاتف..."
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
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">العميل</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">الهاتف</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">المنطقة</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">التاريخ</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">الإجمالي</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">المدفوع</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">المتبقي</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">الحالة</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o: any) => (
                    <tr key={o.id} className="border-b border-zinc-100 hover:bg-zinc-50">
                      <td className="p-3 font-mono text-xs">{o.number}</td>
                      <td className="p-3 font-medium">{o.customerName}</td>
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
                      <td className="p-3 flex gap-1">
                        {Number(o.balance) > 0 && (
                          <button
                            onClick={() => addPayment(o.id)}
                            className="text-xs px-2 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-bold"
                          >
                            دفعة
                          </button>
                        )}
                        <button
                          onClick={() => remove(o.id)}
                          className="text-red-500 hover:text-red-700 p-1"
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
      </div>
    </AppShell>
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
      await api.post('/orders', { ...form, lines });
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
