'use client';

import { useQuery } from '@tanstack/react-query';
import { Wallet, ArrowDownToLine, ArrowUpFromLine, FileCheck } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, CardContent, CardHeader, CardTitle, Stat, Badge } from '@/components/ui';
import { api } from '@/lib/api';
import { formatNumber, formatCurrency, formatDate } from '@/lib/utils';

export default function FinancePage() {
  const { data: summary } = useQuery({
    queryKey: ['finance', 'summary'],
    queryFn: () => api.get('/finance/summary/today').then((r) => r.data),
    refetchInterval: 30_000,
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
          <p className="text-sm text-zinc-500 mt-0.5">الصندوق والشيكات والمصاريف</p>
        </header>

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
