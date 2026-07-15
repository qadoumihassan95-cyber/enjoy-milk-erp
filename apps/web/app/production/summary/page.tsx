'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Filter, Package, BarChart3 } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, CardHeader, CardTitle, CardContent, Stat } from '@/components/ui';
import { api } from '@/lib/api';
import { formatNumber } from '@/lib/utils';

export default function DailySummaryPage() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [itemName, setItemName] = useState('');

  const { data: summary, isLoading } = useQuery({
    queryKey: ['day-summary', date, itemName],
    queryFn: () => {
      const p = new URLSearchParams();
      p.set('date', date);
      if (itemName) p.set('itemName', itemName);
      return api.get(`/daily-production/summary/day?${p.toString()}`).then((r) => r.data);
    },
  });

  const totals = summary?.totals ?? {};

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto p-3 md:p-6 space-y-4 md:space-y-6 pb-24 md:pb-6">
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-zinc-900 text-white flex items-center justify-center">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-black tracking-tight">ملخص الإنتاج اليومي</h1>
              <p className="text-sm text-zinc-500 mt-0.5">إجمالي إنتاج اليوم + المواد الخام + نسبة الفاقد</p>
            </div>
          </div>
        </header>

        {/* الفلاتر */}
        <Card className="p-3 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-zinc-400" />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-10 px-3 rounded-lg border border-zinc-200 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-zinc-400" />
            <input
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="فلتر بالمنتج"
              className="h-10 px-3 rounded-lg border border-zinc-200 text-sm"
            />
          </div>
        </Card>

        {isLoading ? (
          <Card className="p-8 text-center text-zinc-500">جاري التحميل...</Card>
        ) : summary?.recordsCount === 0 ? (
          <Card className="p-12 text-center">
            <p className="text-zinc-500">لا يوجد إنتاج مُسجَّل لهذا اليوم</p>
            <p className="text-xs text-zinc-400 mt-1">أنشئ ورقة إنتاج من صفحة الإنتاج اليومي</p>
          </Card>
        ) : (
          <>
            {/* إجماليات */}
            <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat label="إجمالي الكراتين المنتجة" value={formatNumber(totals.cartons ?? 0, 0)} state="good" />
              <Stat label="إجمالي الطبالي" value={formatNumber(totals.pallets ?? 0, 0)} />
              <Stat
                label="إجمالي الحليب الخام (كغ)"
                value={formatNumber(totals.rawMilkKg ?? 0, 1)}
                hint={
                  (totals.milkBags ?? 0) > 0
                    ? `${totals.milkBags} كيس × ${totals.bagWeightKg ?? 25} كغ`
                    : 'بلا أكياس'
                }
              />
              <Stat
                label="نسبة الفاقد"
                value={`${totals.wasteRate ?? 0}%`}
                state={(totals.wasteRate ?? 0) > 5 ? 'danger' : (totals.wasteRate ?? 0) > 2 ? 'warning' : 'good'}
                hint={`فاقد: ${formatNumber(totals.waste ?? 0, 1)}`}
              />
            </section>

            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              <div className="rounded-xl bg-zinc-50 border border-zinc-100 p-3">
                <div className="text-[10px] font-bold text-zinc-500 uppercase">كرتون مسحوب</div>
                <div className="text-lg font-black mt-1" data-numeric>{formatNumber(totals.cartonUsage ?? 0, 1)}</div>
              </div>
              <div className="rounded-xl bg-zinc-50 border border-zinc-100 p-3">
                <div className="text-[10px] font-bold text-zinc-500 uppercase">ألمنيوم</div>
                <div className="text-lg font-black mt-1" data-numeric>{formatNumber(totals.aluminum ?? 0, 1)}</div>
              </div>
              <div className="rounded-xl bg-amber-50 border border-amber-100 p-3">
                <div className="text-[10px] font-bold text-amber-700 uppercase">عدد أوراق الإنتاج</div>
                <div className="text-lg font-black mt-1 text-amber-700" data-numeric>{summary.recordsCount}</div>
              </div>
            </div>

            {/* تفصيل لكل منتج */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Package className="h-4 w-4" /> إنتاج كل منتج</CardTitle>
              </CardHeader>
              <CardContent>
                {Object.keys(summary.byItem ?? {}).length === 0 ? (
                  <p className="text-sm text-zinc-400 text-center py-4">لا توجد بيانات</p>
                ) : (
                  <div className="space-y-2">
                    {Object.entries(summary.byItem).map(([item, info]: any) => (
                      <div key={item} className="rounded-lg border border-zinc-100 p-3 flex items-center justify-between flex-wrap gap-2">
                        <div className="font-bold text-sm">{item}</div>
                        <div className="text-sm">
                          <span className="text-emerald-700 font-black" data-numeric>
                            {formatNumber(info.totalCartons, 0)}
                          </span>
                          <span className="text-zinc-500 text-xs">
                            {' '}كرتون · {formatNumber(info.totalPallets, 0)} طبلية
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* الملاحظات */}
            {summary.notes?.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>📝 ملاحظات اليوم</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm">
                    {summary.notes.map((n: string, i: number) => (
                      <li key={i} className="rounded bg-zinc-50 p-2 border border-zinc-100">{n}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
