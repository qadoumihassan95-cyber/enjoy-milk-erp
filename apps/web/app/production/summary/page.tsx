'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Filter, Factory, Package, Droplet, AlertTriangle, BarChart3 } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, CardHeader, CardTitle, CardContent, Stat, Badge } from '@/components/ui';
import { api } from '@/lib/api';
import { formatNumber } from '@/lib/utils';

export default function DailySummaryPage() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [itemName, setItemName] = useState('');
  const [machineNumber, setMachineNumber] = useState('');

  const { data: machines } = useQuery({
    queryKey: ['machines'],
    queryFn: () => api.get('/machines').then((r) => r.data),
  });

  const { data: summary, isLoading } = useQuery({
    queryKey: ['day-summary', date, itemName, machineNumber],
    queryFn: () => {
      const p = new URLSearchParams();
      p.set('date', date);
      if (itemName) p.set('itemName', itemName);
      if (machineNumber) p.set('machineNumber', machineNumber);
      return api.get(`/daily-production/summary/day?${p.toString()}`).then((r) => r.data);
    },
  });

  const totals = summary?.totals ?? {};

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-zinc-900 text-white flex items-center justify-center">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-black tracking-tight">ملخص الإنتاج اليومي</h1>
              <p className="text-sm text-zinc-500 mt-0.5">تفصيل لكل ماكينة + لكل منتج + نسبة الفاقد</p>
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
            <select
              value={machineNumber}
              onChange={(e) => setMachineNumber(e.target.value)}
              className="h-10 px-3 rounded-lg border border-zinc-200 text-sm"
            >
              <option value="">كل الماكينات</option>
              {(machines ?? []).map((m: any) => (
                <option key={m.id} value={m.number}>{m.name} (#{m.number})</option>
              ))}
            </select>
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
              <Stat label="حليب خام (لتر)" value={formatNumber(totals.rawMilk ?? 0, 1)} />
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

            {/* تفصيل لكل ماكينة */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Factory className="h-4 w-4" /> إنتاج كل ماكينة</CardTitle>
              </CardHeader>
              <CardContent>
                {Object.keys(summary.byMachine ?? {}).length === 0 ? (
                  <p className="text-sm text-zinc-400 text-center py-4">لا توجد بيانات</p>
                ) : (
                  <div className="space-y-3">
                    {Object.entries(summary.byMachine).map(([machine, info]: any) => (
                      <div key={machine} className="rounded-lg border border-zinc-100 p-3">
                        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="info">ماكينة {machine}</Badge>
                            <span className="text-sm font-bold" data-numeric>
                              {formatNumber(info.totalCartons, 0)} كرتون
                            </span>
                            <span className="text-xs text-zinc-500">
                              ({formatNumber(info.totalPallets, 0)} طبلية)
                            </span>
                          </div>
                        </div>
                        <div className="grid md:grid-cols-2 gap-1.5">
                          {Object.entries(info.items).map(([item, c]: any) => (
                            <div key={item} className="flex justify-between text-xs bg-zinc-50 rounded px-2 py-1.5">
                              <span className="truncate">{item}</span>
                              <span className="font-bold" data-numeric>{formatNumber(c, 0)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* تفصيل لكل منتج (مقارنة بين الماكينات) */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Package className="h-4 w-4" /> مقارنة كل منتج عبر الماكينات</CardTitle>
              </CardHeader>
              <CardContent>
                {Object.keys(summary.byItem ?? {}).length === 0 ? (
                  <p className="text-sm text-zinc-400 text-center py-4">لا توجد بيانات</p>
                ) : (
                  <div className="space-y-3">
                    {Object.entries(summary.byItem).map(([item, info]: any) => (
                      <div key={item} className="rounded-lg border border-zinc-100 p-3">
                        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                          <div className="font-bold text-sm">{item}</div>
                          <div className="text-sm">
                            <span className="text-emerald-700 font-black" data-numeric>{formatNumber(info.totalCartons, 0)}</span>
                            <span className="text-zinc-500 text-xs"> كرتون · {formatNumber(info.totalPallets, 0)} طبلية</span>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 md:grid-cols-4 gap-1.5">
                          {Object.entries(info.byMachine).map(([m, c]: any) => (
                            <div key={m} className="text-xs bg-zinc-50 rounded px-2 py-1.5">
                              <div className="text-zinc-500">ماكينة {m}</div>
                              <div className="font-bold" data-numeric>{formatNumber(c, 0)}</div>
                            </div>
                          ))}
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
