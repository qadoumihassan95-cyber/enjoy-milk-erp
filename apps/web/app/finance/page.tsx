'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Wallet, ArrowDownToLine, ArrowUpFromLine, FileCheck, TrendingUp, TrendingDown, Plus, Receipt } from 'lucide-react';

const EXPENSE_CATEGORIES = [
  'رواتب', 'كهرباء', 'إيجار', 'مشتريات', 'صيانة',
  'مواصلات', 'إنترنت', 'تسويق', 'معدات', 'مصاريف تشغيل', 'أخرى',
];
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';
import { AppShell } from '@/components/app-shell';
import { Card, CardContent, CardHeader, CardTitle, Stat, Badge } from '@/components/ui';
import { api } from '@/lib/api';
import { formatNumber, formatCurrency, formatDate } from '@/lib/utils';

export default function FinancePage() {
  const qc = useQueryClient();
  const [expForm, setExpForm] = useState({ amount: '', category: EXPENSE_CATEGORIES[0], description: '' });
  const [expFilter, setExpFilter] = useState('');

  const { data: summary } = useQuery({
    queryKey: ['finance', 'summary'],
    queryFn: () => api.get('/finance/summary/today').then((r) => r.data),
    refetchInterval: 30_000,
  });

  const { data: expenses } = useQuery({
    queryKey: ['finance', 'expenses'],
    queryFn: () => api.get('/finance/expenses').then((r) => r.data),
    refetchInterval: 30_000,
  });

  const addExpense = useMutation({
    mutationFn: (body: any) => api.post('/finance/expenses', body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['finance'] });
      setExpForm({ amount: '', category: EXPENSE_CATEGORIES[0], description: '' });
    },
    onError: (e: any) => alert(e?.response?.data?.message || 'تعذّرت إضافة المصروف'),
  });

  const submitExpense = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(expForm.amount);
    if (isNaN(amount) || amount <= 0) return alert('أدخل مبلغاً صحيحاً');
    addExpense.mutate({
      amount,
      category: expForm.category,
      description: expForm.description || expForm.category,
    });
  };

  const { data: report } = useQuery({
    queryKey: ['finance', 'report'],
    queryFn: () => api.get('/finance/report').then((r) => r.data),
    refetchInterval: 60_000,
  });

  const { data: cashboxes } = useQuery({
    queryKey: ['cashboxes'],
    queryFn: () => api.get('/finance/cashboxes').then((r) => r.data),
  });

  const { data: cheques } = useQuery({
    queryKey: ['cheques'],
    queryFn: () => api.get('/finance/cheques').then((r) => r.data),
  });

  const { data: movements } = useQuery({
    queryKey: ['cash-movements'],
    queryFn: () => api.get('/finance/movements').then((r) => r.data),
  });

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
        <header>
          <h1 className="text-2xl md:text-3xl font-black tracking-tight">المالية</h1>
          <p className="text-sm text-zinc-500 mt-0.5">التقرير المالي · الصندوق · الشيكات · المصاريف</p>
        </header>

        {/* ─── التقرير المالي (الشهر الحالي) ─── */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h3 className="font-black text-lg">📊 التقرير المالي — الشهر الحالي</h3>
            <span className="text-xs text-zinc-400">
              {report ? `${report.from} → ${report.to}` : ''}
            </span>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <div className="rounded-xl bg-zinc-50 border border-zinc-100 p-3">
              <div className="text-[10px] font-bold text-zinc-500 uppercase">المبيعات</div>
              <div className="text-xl font-black mt-1" data-numeric>
                {formatNumber(report?.totalSales ?? 0, 0)} <span className="text-xs font-normal text-zinc-400">د.أ</span>
              </div>
            </div>
            <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3">
              <div className="text-[10px] font-bold text-emerald-700 uppercase">المحصّل</div>
              <div className="text-xl font-black mt-1 text-emerald-700" data-numeric>
                {formatNumber(report?.collected ?? 0, 0)}
              </div>
            </div>
            <div className="rounded-xl bg-amber-50 border border-amber-100 p-3">
              <div className="text-[10px] font-bold text-amber-700 uppercase">مستحق (دين)</div>
              <div className="text-xl font-black mt-1 text-amber-700" data-numeric>
                {formatNumber(report?.outstanding ?? 0, 0)}
              </div>
            </div>
            <div className="rounded-xl bg-red-50 border border-red-100 p-3">
              <div className="text-[10px] font-bold text-red-700 uppercase">المصاريف</div>
              <div className="text-xl font-black mt-1 text-red-700" data-numeric>
                {formatNumber(report?.totalExpenses ?? 0, 0)}
              </div>
            </div>
          </div>

          {/* صافي الربح */}
          <div
            className={`rounded-xl p-4 mb-5 flex items-center justify-between ${
              (report?.profit ?? 0) >= 0 ? 'bg-emerald-600' : 'bg-red-600'
            } text-white`}
          >
            <div className="flex items-center gap-2">
              {(report?.profit ?? 0) >= 0 ? (
                <TrendingUp className="h-6 w-6" />
              ) : (
                <TrendingDown className="h-6 w-6" />
              )}
              <span className="font-bold">صافي الربح</span>
            </div>
            <div className="text-2xl font-black" data-numeric>
              {formatNumber(report?.profit ?? 0, 0)} د.أ
              <span className="text-sm font-normal opacity-80 mr-2">
                ({report?.margin ?? 0}%)
              </span>
            </div>
          </div>

          {/* الاتجاه الشهري */}
          {report?.trend && report.trend.length > 0 && (
            <div className="mb-5">
              <div className="text-xs font-bold text-zinc-500 mb-2">الاتجاه (آخر 6 أشهر)</div>
              <div style={{ width: '100%', height: 220 }} dir="ltr">
                <ResponsiveContainer>
                  <BarChart data={report.trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="sales" name="مبيعات" fill="#18181b" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expenses" name="مصاريف" fill="#dc2626" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* تصنيف المصاريف */}
          {report?.byCategory && Object.keys(report.byCategory).length > 0 && (
            <div>
              <div className="text-xs font-bold text-zinc-500 mb-2">المصاريف حسب التصنيف</div>
              <div className="space-y-1.5">
                {Object.entries(report.byCategory)
                  .sort((a: any, b: any) => b[1] - a[1])
                  .map(([cat, amt]: any) => {
                    const pct = report.totalExpenses > 0 ? (amt / report.totalExpenses) * 100 : 0;
                    return (
                      <div key={cat} className="flex items-center gap-2 text-sm">
                        <span className="w-28 truncate">{cat}</span>
                        <div className="flex-1 h-2 bg-zinc-100 rounded-full overflow-hidden">
                          <div className="h-full bg-red-400" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-20 text-left font-bold" data-numeric>
                          {formatNumber(amt, 0)}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </Card>

        {/* ─── إدارة المصاريف (إضافة + قائمة) ─── */}
        <Card className="p-5">
          <h3 className="font-black text-lg mb-4 flex items-center gap-2">
            <Receipt className="h-5 w-5" /> المصاريف
          </h3>

          <form onSubmit={submitExpense} className="grid md:grid-cols-4 gap-3 mb-5">
            <div>
              <label className="text-[10px] font-bold text-zinc-500 uppercase">المبلغ (د.أ)</label>
              <input
                type="number"
                step="0.01"
                value={expForm.amount}
                onChange={(e) => setExpForm({ ...expForm, amount: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm mt-1"
                placeholder="0.00"
                required
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-zinc-500 uppercase">التصنيف</label>
              <select
                value={expForm.category}
                onChange={(e) => setExpForm({ ...expForm, category: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm mt-1"
              >
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-zinc-500 uppercase">الوصف (اختياري)</label>
              <input
                value={expForm.description}
                onChange={(e) => setExpForm({ ...expForm, description: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm mt-1"
                placeholder="تفاصيل..."
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={addExpense.isPending}
                className="w-full h-10 rounded-lg bg-zinc-900 text-white text-sm font-bold flex items-center justify-center gap-1.5 hover:bg-zinc-800 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" /> إضافة مصروف
              </button>
            </div>
          </form>

          {/* فلتر التصنيف */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className="text-xs text-zinc-500">فلتر:</span>
            <button
              onClick={() => setExpFilter('')}
              className={`px-2.5 py-1 rounded-md text-xs font-bold ${!expFilter ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600'}`}
            >
              الكل
            </button>
            {EXPENSE_CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setExpFilter(c)}
                className={`px-2.5 py-1 rounded-md text-xs font-bold ${expFilter === c ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600'}`}
              >
                {c}
              </button>
            ))}
          </div>

          {/* قائمة المصاريف */}
          {!expenses || expenses.length === 0 ? (
            <p className="text-sm text-zinc-400 text-center py-6">لا توجد مصاريف مسجّلة</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 border-b border-zinc-200">
                  <tr>
                    <th className="text-right p-2.5 text-[10px] font-bold text-zinc-500 uppercase">التاريخ</th>
                    <th className="text-right p-2.5 text-[10px] font-bold text-zinc-500 uppercase">التصنيف</th>
                    <th className="text-right p-2.5 text-[10px] font-bold text-zinc-500 uppercase">الوصف</th>
                    <th className="text-right p-2.5 text-[10px] font-bold text-zinc-500 uppercase">المبلغ</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses
                    .filter((x: any) => !expFilter || x.category === expFilter)
                    .slice(0, 50)
                    .map((x: any) => (
                      <tr key={x.id} className="border-b border-zinc-100">
                        <td className="p-2.5 text-zinc-500">{formatDate(x.expenseDate)}</td>
                        <td className="p-2.5">
                          <span className="inline-block px-2 py-0.5 rounded-md bg-zinc-100 text-zinc-700 text-xs font-bold">
                            {x.category || 'أخرى'}
                          </span>
                        </td>
                        <td className="p-2.5 text-zinc-600">{x.description || '—'}</td>
                        <td className="p-2.5 font-black text-red-600" data-numeric>
                          {formatNumber(+x.amount, 0)} د.أ
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat
            label="إجمالي الكاش"
            value={formatNumber(summary?.totalBalance ?? 0, 0)}
            unit="د.أ"
          />
          <Stat
            label="وارد اليوم"
            value={formatNumber(summary?.cashIn ?? 0, 0)}
            unit="د.أ"
            state="good"
          />
          <Stat
            label="صادر اليوم"
            value={formatNumber(summary?.cashOut ?? 0, 0)}
            unit="د.أ"
          />
          <Stat
            label="شيكات قريبة"
            value={summary?.upcomingChequesCount ?? 0}
            state={(summary?.upcomingChequesCount ?? 0) > 0 ? 'warning' : 'good'}
          />
        </section>

        <div className="grid lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-4 w-4" /> الصناديق
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {cashboxes?.map((c: any) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-zinc-200"
                >
                  <div>
                    <div className="font-bold text-sm">{c.name}</div>
                    <div className="text-[10px] text-zinc-500 font-mono">{c.code}</div>
                  </div>
                  <div className="text-left">
                    <div className="text-xs text-zinc-500">الرصيد</div>
                    <div className="font-black text-base" data-numeric>
                      {formatCurrency(+c.balance)}
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileCheck className="h-4 w-4" /> الشيكات
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!cheques || cheques.length === 0 ? (
                <p className="text-sm text-zinc-500 text-center py-4">لا توجد شيكات</p>
              ) : (
                <div className="space-y-2">
                  {cheques.slice(0, 5).map((cq: any) => (
                    <div
                      key={cq.id}
                      className="flex items-center justify-between p-3 rounded-lg border border-zinc-200"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold">{cq.number}</span>
                          <Badge
                            variant={
                              cq.status === 'IN_HAND'
                                ? 'info'
                                : cq.status === 'CASHED'
                                ? 'success'
                                : cq.status === 'RETURNED'
                                ? 'danger'
                                : 'default'
                            }
                            dot
                          >
                            {translateChequeStatus(cq.status)}
                          </Badge>
                        </div>
                        <div className="text-xs text-zinc-500 mt-1">
                          {cq.bankName} · استحقاق: {formatDate(cq.dueDate)}
                        </div>
                      </div>
                      <div className="font-bold text-sm" data-numeric>
                        {formatCurrency(+cq.amount)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>آخر الحركات النقدية</CardTitle>
          </CardHeader>
          <CardContent>
            {!movements || movements.length === 0 ? (
              <p className="text-sm text-zinc-500 text-center py-4">لا توجد حركات</p>
            ) : (
              <div className="space-y-2">
                {movements.slice(0, 10).map((m: any) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-zinc-200"
                  >
                    <div className="flex items-center gap-3">
                      {m.type === 'IN' ? (
                        <div className="w-9 h-9 rounded-full bg-emerald-50 flex items-center justify-center">
                          <ArrowDownToLine className="h-4 w-4 text-emerald-600" />
                        </div>
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-amber-50 flex items-center justify-center">
                          <ArrowUpFromLine className="h-4 w-4 text-amber-600" />
                        </div>
                      )}
                      <div>
                        <div className="font-medium text-sm">{m.description || m.type}</div>
                        <div className="text-xs text-zinc-500">
                          {m.cashbox?.name} · {formatDate(m.performedAt)}
                        </div>
                      </div>
                    </div>
                    <div
                      className={`font-bold ${
                        m.type === 'IN' ? 'text-emerald-600' : 'text-amber-600'
                      }`}
                      data-numeric
                    >
                      {m.type === 'IN' ? '+' : '-'}
                      {formatCurrency(+m.amount)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function translateChequeStatus(status: string): string {
  const map: Record<string, string> = {
    IN_HAND: 'في الحوزة',
    DEPOSITED: 'مودع',
    CASHED: 'مصروف',
    RETURNED: 'مرتد',
    CANCELLED: 'ملغي',
  };
  return map[status] ?? status;
}
