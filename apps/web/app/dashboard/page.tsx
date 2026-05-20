'use client';

import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/app-shell';
import { Stat, Card, CardHeader, CardTitle, CardContent, Badge } from '@/components/ui';
import { api } from '@/lib/api';
import { formatNumber } from '@/lib/utils';

export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'executive'],
    queryFn: () => api.get('/dashboard/executive').then((r) => r.data),
    refetchInterval: 60_000,
  });

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
        <header className="flex items-baseline justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight">اليوم</h1>
            <p className="text-sm text-zinc-500 mt-0.5" data-numeric>
              {new Date().toLocaleDateString('ar-JO', { dateStyle: 'long' })}
            </p>
          </div>
          <Badge variant="success" dot>
            مباشر
          </Badge>
        </header>

        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat
            label="الإنتاج اليوم"
            value={isLoading ? '—' : formatNumber(data?.production?.totalOutput ?? 0)}
            unit="حبة"
            state="neutral"
          />
          <Stat
            label="نسبة الهدر"
            value={
              isLoading
                ? '—'
                : ((data?.production?.wastePct ?? 0) * 100).toFixed(1)
            }
            unit="%"
            state={(data?.production?.wastePct ?? 0) < 0.05 ? 'good' : 'warning'}
          />
          <Stat
            label="إجمالي الكاش"
            value={isLoading ? '—' : formatNumber(data?.finance?.totalBalance ?? 0, 0)}
            unit="د.أ"
          />
          <Stat
            label="الحضور"
            value={
              isLoading ? '—' : `${data?.hr?.present ?? 0}/${data?.hr?.total ?? 0}`
            }
            state={(data?.hr?.late ?? 0) > 0 ? 'warning' : 'good'}
            hint={(data?.hr?.late ?? 0) > 0 ? `${data?.hr?.late} تأخير` : 'مكتمل'}
          />
        </section>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>المخزون</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="إجمالي الأصناف" value={data?.inventory?.itemsCount ?? 0} />
              <Row
                label="منخفض"
                value={data?.inventory?.lowStockCount ?? 0}
                warning={(data?.inventory?.lowStockCount ?? 0) > 0}
              />
              <Row
                label="قارب الانتهاء"
                value={data?.inventory?.expiringBatches ?? 0}
                warning={(data?.inventory?.expiringBatches ?? 0) > 0}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>المالية</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row
                label="الكاش الوارد اليوم"
                value={`${formatNumber(data?.finance?.cashIn ?? 0, 2)} د.أ`}
              />
              <Row
                label="الكاش الصادر اليوم"
                value={`${formatNumber(data?.finance?.cashOut ?? 0, 2)} د.أ`}
              />
              <Row
                label="شيكات قريبة الاستحقاق"
                value={data?.finance?.upcomingChequesCount ?? 0}
                warning={(data?.finance?.upcomingChequesCount ?? 0) > 0}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>الرخص</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="إجمالي" value={data?.licenses?.total ?? 0} />
              <Row
                label="قاربت على الانتهاء"
                value={data?.licenses?.expiring ?? 0}
                warning={(data?.licenses?.expiring ?? 0) > 0}
              />
              <Row
                label="منتهية"
                value={data?.licenses?.expired ?? 0}
                danger={(data?.licenses?.expired ?? 0) > 0}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function Row({
  label,
  value,
  warning,
  danger,
}: {
  label: string;
  value: any;
  warning?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-zinc-50 last:border-0">
      <span className="text-zinc-600">{label}</span>
      <span
        className={
          danger
            ? 'font-bold text-red-600'
            : warning
            ? 'font-bold text-amber-600'
            : 'font-bold'
        }
        data-numeric
      >
        {value}
      </span>
    </div>
  );
}
