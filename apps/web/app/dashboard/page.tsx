'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Boxes,
  ScrollText,
  Factory,
  UserCheck,
  ArrowUpRight,
} from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, CardHeader, CardTitle, CardContent, Badge } from '@/components/ui';
import { api } from '@/lib/api';
import { formatNumber } from '@/lib/utils';

/**
 * Dashboard — نسخة نظيفة بعد إزالة قسم المالية بالكامل (بطاقة المالية + إجمالي الكاش).
 * البطاقات المتبقية (المخزون / الرخص / الإنتاج) تفاعلية Clickable مع Hover + Ripple + Cursor.
 */
export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'executive'],
    queryFn: () => api.get('/dashboard/executive').then((r) => r.data),
    refetchInterval: 60_000,
  });

  const p = data?.production ?? {};
  const inv = data?.inventory ?? {};
  const lic = data?.licenses ?? {};
  const hr = data?.hr ?? {};
  const wastePct = ((p.wastePct ?? 0) * 100);

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

        {/* ──────────────────────────────────────────────
             KPIs الرئيسية — 3 بطاقات (المالية والكاش أُزيلا)
             بطاقة الإنتاج قابلة للضغط وتفتح جدول الأيام
        ────────────────────────────────────────────── */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* الإنتاج اليوم — قابلة للضغط */}
          <InteractiveKpi
            href="/production"
            icon={<Factory className="h-4 w-4" />}
            label="الإنتاج اليوم"
            value={isLoading ? '—' : formatNumber(p.totalOutput ?? 0)}
            unit="حبة"
            hint="اضغط لعرض جدول الأيام"
            accent="zinc"
          />
          {/* نسبة الهدر */}
          <div
            className={`rounded-xl border-2 bg-white p-4 ${
              wastePct < 5 ? 'border-emerald-200' : 'border-amber-200'
            }`}
          >
            <div className="text-xs text-zinc-500">نسبة الهدر</div>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span
                data-numeric
                className="text-2xl md:text-3xl font-black tracking-tight text-zinc-900"
              >
                {isLoading ? '—' : wastePct.toFixed(1)}
              </span>
              <span className="text-xs text-zinc-400">%</span>
            </div>
            <div className="mt-1.5 text-[11px] text-zinc-500">
              {wastePct < 5 ? 'ضمن الحدود المقبولة' : 'يحتاج مراجعة'}
            </div>
          </div>
          {/* الحضور */}
          <div className="rounded-xl border-2 bg-white p-4 border-emerald-200">
            <div className="text-xs text-zinc-500 flex items-center gap-1.5">
              <UserCheck className="h-3.5 w-3.5" /> الحضور
            </div>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span
                data-numeric
                className="text-2xl md:text-3xl font-black tracking-tight text-zinc-900"
              >
                {isLoading ? '—' : `${hr.present ?? 0}/${hr.total ?? 0}`}
              </span>
            </div>
            <div className="mt-1.5 text-[11px] text-zinc-500">
              {(hr.late ?? 0) > 0 ? `${hr.late} تأخير` : 'مكتمل'}
            </div>
          </div>
        </section>

        {/* ──────────────────────────────────────────────
             بطاقات تفاعلية كبيرة: المخزون + الرخص
        ────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* المخزون */}
          <ClickableCard href="/inventory" label="فتح المخزون">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Boxes className="h-4 w-4 text-emerald-600" />
                  المخزون
                </span>
                <ArrowUpRight className="h-4 w-4 text-zinc-400 group-hover:text-zinc-900 group-hover:translate-x-[-2px] group-hover:translate-y-[2px] transition-all duration-200" />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="إجمالي الأصناف" value={inv.itemsCount ?? 0} />
              <Row
                label="منخفض"
                value={inv.lowStockCount ?? 0}
                warning={(inv.lowStockCount ?? 0) > 0}
              />
              <Row
                label="قارب الانتهاء"
                value={inv.expiringBatches ?? 0}
                warning={(inv.expiringBatches ?? 0) > 0}
              />
            </CardContent>
          </ClickableCard>

          {/* الرخص */}
          <ClickableCard href="/licenses" label="فتح الرخص">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <ScrollText className="h-4 w-4 text-blue-600" />
                  الرخص
                </span>
                <ArrowUpRight className="h-4 w-4 text-zinc-400 group-hover:text-zinc-900 group-hover:translate-x-[-2px] group-hover:translate-y-[2px] transition-all duration-200" />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="إجمالي" value={lic.total ?? 0} />
              <Row
                label="قاربت على الانتهاء"
                value={lic.expiring ?? 0}
                warning={(lic.expiring ?? 0) > 0}
              />
              <Row
                label="منتهية"
                value={lic.expired ?? 0}
                danger={(lic.expired ?? 0) > 0}
              />
            </CardContent>
          </ClickableCard>
        </div>
      </div>
    </AppShell>
  );
}

/* ────────────────────────────────────────────────
   بطاقة تفاعلية صغيرة (KPI): Link + Hover + Ripple
────────────────────────────────────────────────── */
function InteractiveKpi({
  href,
  icon,
  label,
  value,
  unit,
  hint,
  accent = 'zinc',
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  value: string | number;
  unit?: string;
  hint?: string;
  accent?: 'zinc' | 'blue' | 'emerald';
}) {
  const accents: Record<string, string> = {
    zinc: 'hover:border-zinc-900/50 hover:shadow-md',
    blue: 'hover:border-blue-400 hover:shadow-md',
    emerald: 'hover:border-emerald-400 hover:shadow-md',
  };
  return (
    <Link
      href={href}
      className={`group relative overflow-hidden rounded-xl border-2 border-zinc-200 bg-white p-4 cursor-pointer transition-all duration-200 active:scale-[0.98] ${accents[accent]} focus:outline-none focus:ring-2 focus:ring-zinc-900/20`}
    >
      {/* Ripple / shimmer effect */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out bg-gradient-to-r from-transparent via-zinc-900/[0.04] to-transparent"
      />
      <div className="relative">
        <div className="flex items-center justify-between">
          <div className="text-xs text-zinc-500 flex items-center gap-1.5">
            {icon} {label}
          </div>
          <ArrowUpRight className="h-3.5 w-3.5 text-zinc-300 group-hover:text-zinc-900 transition-colors" />
        </div>
        <div className="flex items-baseline gap-1.5 mt-1">
          <span
            data-numeric
            className="text-2xl md:text-3xl font-black tracking-tight text-zinc-900"
          >
            {value}
          </span>
          {unit && <span className="text-xs text-zinc-400">{unit}</span>}
        </div>
        {hint && (
          <div className="mt-1.5 text-[11px] text-zinc-500 group-hover:text-zinc-700 transition-colors">
            {hint}
          </div>
        )}
      </div>
    </Link>
  );
}

/* ────────────────────────────────────────────────
   بطاقة كبيرة تفاعلية (Inventory / Licenses)
────────────────────────────────────────────────── */
function ClickableCard({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="group block rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-900/20"
    >
      <Card
        className="relative overflow-hidden cursor-pointer transition-all duration-200 hover:shadow-md hover:border-zinc-300 active:scale-[0.995]"
      >
        {/* ripple shimmer */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out bg-gradient-to-r from-transparent via-zinc-900/[0.035] to-transparent"
        />
        <div className="relative">{children}</div>
      </Card>
    </Link>
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
