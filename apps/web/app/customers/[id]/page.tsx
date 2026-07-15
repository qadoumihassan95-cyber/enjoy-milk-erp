'use client';

import { useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Phone,
  MapPin,
  Mail,
  Printer,
  Wallet,
  Receipt,
  ShoppingCart,
  User,
} from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, CardHeader, CardTitle, CardContent, Badge, Button, Stat } from '@/components/ui';
import { api } from '@/lib/api';
import { formatNumber, formatDate } from '@/lib/utils';
import { FACTORY_NAME } from '@/lib/branding';

/**
 * صفحة تفاصيل العميل — تعرض:
 *  - معلومات العميل، الفواتير كلها (مدفوعة/غير مدفوعة)،
 *    إجمالي المبيعات، المحصل، الدين، الدفعات، وكشف حساب كامل.
 *  - زر طباعة كشف الحساب بمقاس A4 مع إخفاء الأزرار والقائمة الجانبية.
 */
export default function CustomerDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const { data: customer, isLoading } = useQuery({
    queryKey: ['customer', id],
    queryFn: () => api.get(`/customers/${id}`).then((r) => r.data),
    enabled: !!id,
  });

  const { data: orders } = useQuery({
    queryKey: ['orders', 'by-customer', id],
    queryFn: () =>
      api.get('/orders', { params: { customerId: id } }).then((r) => r.data),
    enabled: !!id,
  });

  const { data: payments } = useQuery({
    queryKey: ['payments', 'by-customer', id],
    queryFn: () =>
      api
        .get('/customers/payments/list', { params: { customerId: id } })
        .then((r) => r.data)
        .catch(() => []),
    enabled: !!id,
  });

  const summary = useMemo(() => {
    const ordList = (orders ?? []) as any[];
    const payList = (payments ?? []) as any[];
    const totalSales = ordList.reduce(
      (s, o) => s + Number(o.total ?? o.grandTotal ?? 0),
      0,
    );
    const totalPaidOrders = ordList.reduce(
      (s, o) => s + Number(o.paidAmount ?? 0),
      0,
    );
    const totalPaymentsRecorded = payList.reduce(
      (s, p) => s + Number(p.amount ?? 0),
      0,
    );
    const collected = Math.max(totalPaidOrders, totalPaymentsRecorded);
    const outstanding = Math.max(0, totalSales - collected);
    const paidInvoices = ordList.filter(
      (o) => Number(o.paidAmount ?? 0) >= Number(o.total ?? o.grandTotal ?? 0),
    );
    const unpaidInvoices = ordList.filter(
      (o) => Number(o.paidAmount ?? 0) < Number(o.total ?? o.grandTotal ?? 0),
    );
    return {
      totalSales,
      collected,
      outstanding,
      paidInvoices,
      unpaidInvoices,
      count: ordList.length,
    };
  }, [orders, payments]);

  const doPrint = () => window.print();

  if (isLoading || !customer) {
    return (
      <AppShell>
        <div className="p-12 text-center text-zinc-500">جاري التحميل...</div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto p-3 md:p-6 space-y-4 md:space-y-5 pb-24 md:pb-6 print:p-2">
        <header className="flex items-center justify-between flex-wrap gap-3 print:hidden">
          <div>
            <button
              onClick={() => router.push('/customers')}
              className="text-sm text-zinc-500 mb-1 flex items-center gap-1 hover:text-zinc-900"
            >
              <ArrowRight className="h-4 w-4 rotate-180" /> العودة للعملاء
            </button>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight flex items-center gap-2">
              <User className="h-6 w-6 text-zinc-500" /> {customer.name}
            </h1>
            <p className="text-sm text-zinc-500 mt-0.5 font-mono">{customer.code}</p>
          </div>
          <Button onClick={doPrint} variant="outline">
            <Printer className="h-4 w-4" /> طباعة كشف الحساب
          </Button>
        </header>

        {/* بيانات الطباعة */}
        <div className="hidden print:block mb-4 border-b border-zinc-900 pb-3 text-center">
          <div className="text-lg font-black">{FACTORY_NAME}</div>
          <div className="text-sm">كشف حساب العميل: {customer.name}</div>
          <div className="text-xs text-zinc-600">
            {new Date().toLocaleDateString('ar-JO', { dateStyle: 'long' })}
          </div>
        </div>

        {/* معلومات الاتصال */}
        <Card>
          <CardContent className="p-4">
            <div className="grid md:grid-cols-4 gap-3 text-sm">
              <Info icon={<Phone className="h-4 w-4" />} label="الهاتف" value={customer.phone || '-'} />
              <Info icon={<Mail className="h-4 w-4" />} label="البريد" value={customer.email || '-'} />
              <Info icon={<MapPin className="h-4 w-4" />} label="العنوان" value={customer.address || '-'} />
              <Info label="النوع" value={<Badge>{translateType(customer.type)}</Badge>} />
            </div>
          </CardContent>
        </Card>

        {/* KPIs مالية */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="إجمالي المبيعات" value={`${formatNumber(summary.totalSales, 2)} د.أ`} state="neutral" />
          <Stat label="إجمالي المحصّل" value={`${formatNumber(summary.collected, 2)} د.أ`} state="good" />
          <Stat
            label="المستحق (الدين)"
            value={`${formatNumber(summary.outstanding, 2)} د.أ`}
            state={summary.outstanding > 0 ? 'warning' : 'good'}
          />
          <Stat label="عدد الفواتير" value={summary.count} />
        </section>

        {/* الفواتير غير المدفوعة */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-amber-600" /> الفواتير غير المدفوعة
              <Badge variant="warning">{summary.unpaidInvoices.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summary.unpaidInvoices.length === 0 ? (
              <p className="text-sm text-zinc-400 text-center py-4">لا يوجد</p>
            ) : (
              <OrdersTable list={summary.unpaidInvoices} onOpen={(oid) => router.push(`/orders?open=${oid}`)} />
            )}
          </CardContent>
        </Card>

        {/* الفواتير المدفوعة */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-emerald-600" /> الفواتير المدفوعة
              <Badge variant="success">{summary.paidInvoices.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summary.paidInvoices.length === 0 ? (
              <p className="text-sm text-zinc-400 text-center py-4">لا يوجد</p>
            ) : (
              <OrdersTable list={summary.paidInvoices} onOpen={(oid) => router.push(`/orders?open=${oid}`)} />
            )}
          </CardContent>
        </Card>

        {/* الدفعات */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-blue-600" /> الدفعات المُسجَّلة
              <Badge>{(payments ?? []).length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!payments || payments.length === 0 ? (
              <p className="text-sm text-zinc-400 text-center py-4">لا توجد دفعات</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 border-b">
                    <tr>
                      <th className="text-right p-2 text-[10px] font-bold text-zinc-500">التاريخ</th>
                      <th className="text-right p-2 text-[10px] font-bold text-zinc-500">المبلغ</th>
                      <th className="text-right p-2 text-[10px] font-bold text-zinc-500">الطريقة</th>
                      <th className="text-right p-2 text-[10px] font-bold text-zinc-500">مرجع</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p: any) => (
                      <tr key={p.id} className="border-b border-zinc-100">
                        <td className="p-2">{formatDate(p.paidAt ?? p.createdAt)}</td>
                        <td className="p-2 font-bold text-emerald-700" data-numeric>
                          {formatNumber(+p.amount, 2)} د.أ
                        </td>
                        <td className="p-2">{p.method ?? '-'}</td>
                        <td className="p-2 text-xs text-zinc-500">{p.reference ?? p.notes ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <style jsx global>{`
        @media print {
          @page { size: A4 portrait; margin: 15mm; }
          nav, .print\\:hidden { display: none !important; }
          body { background: white; }
        }
      `}</style>
    </AppShell>
  );
}

function Info({ icon, label, value }: { icon?: React.ReactNode; label: string; value: any }) {
  return (
    <div>
      <div className="text-[11px] text-zinc-500 flex items-center gap-1">
        {icon} {label}
      </div>
      <div className="font-bold text-zinc-900 mt-0.5">{value}</div>
    </div>
  );
}

function OrdersTable({ list, onOpen }: { list: any[]; onOpen: (id: string) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 border-b">
          <tr>
            <th className="text-right p-2 text-[10px] font-bold text-zinc-500">رقم الطلب</th>
            <th className="text-right p-2 text-[10px] font-bold text-zinc-500">التاريخ</th>
            <th className="text-right p-2 text-[10px] font-bold text-zinc-500">النوع</th>
            <th className="text-right p-2 text-[10px] font-bold text-zinc-500">الإجمالي</th>
            <th className="text-right p-2 text-[10px] font-bold text-zinc-500">مدفوع</th>
            <th className="text-right p-2 text-[10px] font-bold text-zinc-500">متبقي</th>
            <th className="text-right p-2 text-[10px] font-bold text-zinc-500 print:hidden">فتح</th>
          </tr>
        </thead>
        <tbody>
          {list.map((o: any) => {
            const total = Number(o.total ?? o.grandTotal ?? 0);
            const paid = Number(o.paidAmount ?? 0);
            const rem = total - paid;
            return (
              <tr key={o.id} className="border-b border-zinc-100 hover:bg-zinc-50">
                <td className="p-2 font-mono text-xs">{o.number ?? o.id.slice(0, 6)}</td>
                <td className="p-2">{formatDate(o.orderDate ?? o.createdAt)}</td>
                <td className="p-2">
                  <Badge variant={o.orderType === 'EXTERNAL' ? 'warning' : 'default'}>
                    {o.orderType === 'EXTERNAL' ? 'خارجي' : 'داخلي'}
                  </Badge>
                </td>
                <td className="p-2 font-bold" data-numeric>
                  {formatNumber(total, 2)}
                </td>
                <td className="p-2 text-emerald-700 font-bold" data-numeric>
                  {formatNumber(paid, 2)}
                </td>
                <td className={`p-2 font-bold ${rem > 0 ? 'text-amber-600' : 'text-zinc-500'}`} data-numeric>
                  {formatNumber(rem, 2)}
                </td>
                <td className="p-2 print:hidden">
                  <button
                    onClick={() => onOpen(o.id)}
                    className="text-xs px-2 py-1 rounded bg-zinc-100 hover:bg-zinc-200"
                  >
                    فتح
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function translateType(t: string): string {
  const map: Record<string, string> = {
    RETAIL: 'تجزئة',
    WHOLESALE: 'جملة',
    DISTRIBUTOR: 'موزع',
    INSTITUTION: 'مؤسسة',
  };
  return map[t] ?? t;
}
