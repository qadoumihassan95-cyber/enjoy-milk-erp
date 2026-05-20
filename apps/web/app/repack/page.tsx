'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Zap } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, CardContent, CardHeader, CardTitle, Stat, Badge, Button } from '@/components/ui';
import { api } from '@/lib/api';
import { formatNumber } from '@/lib/utils';

export default function RepackPage() {
  const { data: summary } = useQuery({
    queryKey: ['repack', 'summary'],
    queryFn: () => api.get('/repack/summary/today').then((r) => r.data),
    refetchInterval: 30_000,
  });

  const { data: machines } = useQuery({
    queryKey: ['repack', 'machines'],
    queryFn: () => api.get('/repack/machines').then((r) => r.data),
  });

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight">التعبئة</h1>
            <p className="text-sm text-zinc-500 mt-0.5">إنتاج اليوم والماكينات</p>
          </div>
          <Link href="/repack/quick">
            <Button size="lg">
              <Zap className="h-4 w-4" />
              إدخال سريع
            </Button>
          </Link>
        </header>

        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat
            label="الإنتاج اليوم"
            value={formatNumber(summary?.totalOutput ?? 0)}
            unit="حبة"
          />
          <Stat
            label="الهدر"
            value={formatNumber(summary?.totalWaste ?? 0)}
            unit="حبة"
            state={(summary?.totalWaste ?? 0) > 50 ? 'warning' : 'good'}
          />
          <Stat
            label="تشغيلات نشطة"
            value={summary?.activeRuns ?? 0}
          />
          <Stat
            label="مكتملة"
            value={summary?.completedRuns ?? 0}
            state="good"
          />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>الماكينات</CardTitle>
          </CardHeader>
          <CardContent className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {machines?.map((m: any) => (
              <div
                key={m.id}
                className="border border-zinc-200 rounded-lg p-4 hover:border-zinc-900 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold">{m.name}</span>
                  <Badge variant="success" dot>
                    نشطة
                  </Badge>
                </div>
                <div className="text-xs text-zinc-500 mb-1">{m.line?.name}</div>
                <div className="text-xs text-zinc-600 font-mono">{m.code}</div>
                {m.capacityPerHour && (
                  <div className="mt-2 text-xs text-zinc-500">
                    السعة: {formatNumber(+m.capacityPerHour)} / ساعة
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
