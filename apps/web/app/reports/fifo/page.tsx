'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Layers,
  TrendingUp,
  Package,
  Warehouse,
  Calendar,
} from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, CardHeader, CardTitle, CardContent, Stat, Badge } from '@/components/ui';
import { api } from '@/lib/api';
import { formatNumber, formatDate } from '@/lib/utils';

/**
 * تقارير FIFO — قيمة المخزون FIFO، تكلفة البضاعة المباعة (COGS)،
 * الربح الإجمالي، حركة الدفعات، الرصيد المتبقي لكل دفعة.
 */
export default function FifoReportsPage() {
  const router = useRouter();
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  const { data: value } = useQuery({
    queryKey: ['fifo', 'inventory-value'],
    queryFn: () => api.get('/fifo/reports/inventory-value').then((r) => r.data),
  });

  const { data: cogs } = useQuery({
    queryKey: ['fifo', 'cogs-profit', from, to],
    queryFn: () =>
      api.get('/fifo/reports/cogs-profit', { params: { from, to } }).then((r) => r.data),
  });

  const { data: batches } = useQuery({
    queryKey: ['fifo', 'batches', 'all'],
    queryFn: () => api.get('/fifo/batches').then((r) => r.data),
  });

  const openBatches = (batches ?? []).filter((b: any) => Number(b.remaining) > 0);
  const closedBatches = (batches ?? []).filter((b: any) => Number(b.remaining) <= 0);

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto p-3 md:p-6 space-y-4 md:space-y-6 pb-24 md:pb-6">
        <header>
          <button onClick={() => router.push('/reports')} className="text-sm text-zinc-500 mb-2 flex items-center gap-1 hover:text-zinc-900">
            <ArrowRight className="h-4 w-4 rotate-180" /> العودة للتقارير
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-black tracking-tight">تقارير FIFO</h1>
              <p className="text-sm text-zinc-500 mt-0.5">
                قيمة المخزون · COGS · الربح · حركة الدفعات
              </p>
            </div>
          </div>
        </header>

        {/* فلترة تاريخية */}
        <Card className="p-3 flex items-center gap-3 flex-wrap">
          <Calendar className="h-4 w-4 text-zinc-400" />
          <label className="text-xs font-bold text-zinc-700">من</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-10 px-3 rounded-lg border border-zinc-200 text-sm"
          />
          <label className="text-xs font-bold text-zinc-700">إلى</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-10 px-3 rounded-lg border border-zinc-200 text-sm"
          />
        </Card>

        {/* الملخص */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat
            label="قيمة المخزون الحالية (FIFO)"
            value={`${formatNumber(value?.totalValue ?? 0, 2)} د.أ`}
            state="good"
          />
          <Stat
            label="إجمالي المبيعات"
            value={`${formatNumber(cogs?.revenue ?? 0, 2)} د.أ`}
          />
          <Stat
            label="تكلفة البضاعة (COGS)"
            value={`${formatNumber(cogs?.cogs ?? 0, 2)} د.أ`}
            state="warning"
          />
          <Stat
            label="الربح الإجمالي"
            value={`${formatNumber(cogs?.grossProfit ?? 0, 2)} د.أ`}
            hint={`هامش ${cogs?.grossMargin ?? 0}%`}
            state="good"
          />
        </section>

        {/* دفعات مفتوحة */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-4 w-4 text-emerald-600" /> دفعات مفتوحة (رصيد متبقٍ)
              <Badge variant="success">{openBatches.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {openBatches.length === 0 ? (
              <p className="text-sm text-zinc-400 text-center py-4">لا توجد دفعات مفتوحة</p>
            ) : (
              <BatchesTable list={openBatches} />
            )}
          </CardContent>
        </Card>

        {/* دفعات مستهلَكة بالكامل */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Warehouse className="h-4 w-4 text-zinc-500" /> دفعات مستهلَكة بالكامل
              <Badge>{closedBatches.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {closedBatches.length === 0 ? (
              <p className="text-sm text-zinc-400 text-center py-4">لا توجد</p>
            ) : (
              <BatchesTable list={closedBatches} />
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function BatchesTable({ list }: { list: any[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 border-b">
          <tr>
            <th className="text-right p-2 text-[10px] font-bold text-zinc-500">تاريخ الشراء</th>
            <th className="text-right p-2 text-[10px] font-bold text-zinc-500">رقم الدفعة</th>
            <th className="text-right p-2 text-[10px] font-bold text-zinc-500">الكمية</th>
            <th className="text-right p-2 text-[10px] font-bold text-zinc-500">المتبقي</th>
            <th className="text-right p-2 text-[10px] font-bold text-zinc-500">سعر التكلفة</th>
            <th className="text-right p-2 text-[10px] font-bold text-zinc-500">قيمة المتبقي</th>
          </tr>
        </thead>
        <tbody>
          {list.map((b: any) => {
            const rem = Number(b.remaining);
            const uc = Number(b.unitCost);
            return (
              <tr key={b.id} className="border-b border-zinc-100 hover:bg-zinc-50">
                <td className="p-2">{formatDate(b.purchaseDate)}</td>
                <td className="p-2 font-mono text-xs">{b.batchNumber ?? '-'}</td>
                <td className="p-2 font-bold" data-numeric>{formatNumber(+b.quantity, 3)}</td>
                <td className={`p-2 font-bold ${rem > 0 ? 'text-emerald-700' : 'text-zinc-400'}`} data-numeric>
                  {formatNumber(rem, 3)}
                </td>
                <td className="p-2" data-numeric>{formatNumber(uc, 4)}</td>
                <td className="p-2 font-bold text-blue-700" data-numeric>
                  {formatNumber(rem * uc, 2)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
