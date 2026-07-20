'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Boxes,
  ScrollText,
  Factory,
  UserCheck,
  ArrowUpRight,
  ShoppingCart,
  Users,
  RefreshCw,
  ChevronLeft,
} from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, CardHeader, CardTitle, CardContent, Badge } from '@/components/ui';
import { api } from '@/lib/api';
import { formatNumber } from '@/lib/utils';

/**
 * Dashboard —
 *   Desktop path (≥ md): DOM identical to the prior version, wrapped in
 *                        `hidden md:block` so nothing on desktop changes.
 *   Mobile path (< md):  new native-feel layout under `md:hidden`.
 *
 * Every feature visible on desktop is also reachable on mobile:
 *   - Production KPI  → tap the dark hero card (routes to /production)
 *   - Waste %          → second carousel card, colored by threshold
 *   - Attendance       → third carousel card
 *   - Inventory        → list card (Total items · Low stock · Expiring)  → /inventory
 *   - Licenses         → list card (Total · Expiring · Expired)          → /licenses
 *   - Quick tiles      → Orders, Customers (both linked in the sidebar)
 */
export default function DashboardPage() {
  const { data, isLoading, isError, dataUpdatedAt, refetch, isFetching } = useQuery({
    queryKey: ['dashboard', 'executive'],
    queryFn: () => api.get('/dashboard/executive').then((r) => r.data),
    refetchInterval: 60_000,
    retry: 1,
  });

  const p = data?.production ?? {};
  const inv = data?.inventory ?? {};
  const lic = data?.licenses ?? {};
  const hr = data?.hr ?? {};
  const ord = data?.orders ?? {};
  const cust = data?.customers ?? {};
  const wastePct = ((p.wastePct ?? 0) * 100);

  // Production KPI display value — NEVER show a silent 0 on an error.
  // Contract:
  //   loading                → "—"
  //   error (or missing data)→ "تعذر التحميل"
  //   real 0                 → "0"      (production truly is zero)
  //   real value             → formatted number
  const productionDisplay: string =
    isLoading ? '—'
    : (isError || !data) ? 'تعذر التحميل'
    : formatNumber(Number(p.totalOutput ?? 0));

  return (
    <AppShell>
      {/* ═══════════════════════════════════════════════
          DESKTOP (≥ md) — UNCHANGED from the prior version.
          Only wrapper added: `hidden md:block`.
      ═══════════════════════════════════════════════ */}
      <div className="hidden md:block max-w-6xl mx-auto p-4 md:p-6 space-y-6">
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
            value={productionDisplay}
            unit={isError || !data ? '' : 'حبة'}
            hint={
              isError || !data
                ? 'تعذر تحميل إنتاج اليوم — اضغط للمحاولة'
                : 'اضغط لعرض جدول الأيام'
            }
            accent={isError ? 'zinc' : 'zinc'}
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

      {/* ═══════════════════════════════════════════════
          MOBILE (< md) — new unified mobile layout.
          Every desktop feature preserved. Guarded by md:hidden
          so desktop DOM is not affected.
      ═══════════════════════════════════════════════ */}
      <MobileDashboard
        p={p} inv={inv} lic={lic} hr={hr} ord={ord} cust={cust}
        wastePct={wastePct}
        isLoading={isLoading}
        isError={isError || (!isLoading && !data)}
        productionDisplay={productionDisplay}
        isFetching={isFetching}
        lastUpdate={dataUpdatedAt}
        onRefresh={() => refetch()}
      />
    </AppShell>
  );
}

/* ═══════════════════════════════════════════════════════════
   Mobile-only view — appears under md breakpoint.
   Layout: compact greeting → KPI carousel → detail lists →
   quick tiles. Nothing hidden vs desktop.
═══════════════════════════════════════════════════════════ */
function MobileDashboard({
  p, inv, lic, hr, ord, cust,
  wastePct, isLoading, isError, productionDisplay,
  isFetching, lastUpdate, onRefresh,
}: {
  p: any; inv: any; lic: any; hr: any; ord: any; cust: any;
  wastePct: number;
  isLoading: boolean;
  isError: boolean;
  productionDisplay: string;
  isFetching: boolean;
  lastUpdate: number;
  onRefresh: () => void;
}) {
  const hour = new Date().getHours();
  const greeting =
    hour < 5 ? 'مساء الخير' :
    hour < 12 ? 'صباح الخير' :
    hour < 18 ? 'مساء الخير' :
    'مساء الخير';

  const syncedAgo = lastUpdate ? Math.max(0, Math.round((Date.now() - lastUpdate) / 1000)) : 0;
  const syncLabel =
    !lastUpdate ? '—' :
    syncedAgo < 5 ? 'حُدِّث الآن' :
    syncedAgo < 60 ? `منذ ${syncedAgo} ث` :
    `منذ ${Math.floor(syncedAgo / 60)} د`;

  // Order/Customer counts — accept multiple field shapes without
  // touching backend contracts.
  const orderCount = ord.count ?? ord.total ?? ord.openCount ?? 0;
  const customerCount = cust.count ?? cust.total ?? cust.activeCount ?? 0;

  return (
    <div className="md:hidden" dir="rtl">
      <div className="px-3 pt-3 pb-4 space-y-3">
        {/* Compact greeting header */}
        <header className="flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-[11px] text-zinc-500">{greeting}</div>
            <div className="text-lg font-black tracking-tight leading-tight truncate">
              {new Date().toLocaleDateString('ar-JO', { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            aria-label="تحديث البيانات"
            className="flex items-center gap-1.5 text-[11px] text-zinc-500 active:scale-95 transition-transform min-h-[44px] px-2"
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.13)]" />
            <span className="whitespace-nowrap">مباشر · {syncLabel}</span>
            <RefreshCw className={`h-3.5 w-3.5 text-zinc-400 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </header>

        {/* KPI carousel — horizontal snap-scroll */}
        <div
          className="flex gap-2 overflow-x-auto snap-x snap-mandatory pb-1 -mx-3 px-3 [&::-webkit-scrollbar]:hidden"
          style={{ scrollbarWidth: 'none' }}
          role="region"
          aria-label="مؤشرات اليوم"
        >
          {/* الإنتاج — hero, clickable */}
          <Link
            href="/production"
            aria-label="فتح الإنتاج اليومي"
            className="snap-start flex-shrink-0 w-[62%] rounded-2xl p-3.5 bg-gradient-to-br from-zinc-900 to-zinc-700 text-white active:scale-[0.98] transition-transform min-h-[104px] flex flex-col justify-between"
          >
            <div className="flex items-center justify-between">
              <div className="text-[10px] text-zinc-300 flex items-center gap-1">
                <Factory className="h-3 w-3" /> الإنتاج اليوم
              </div>
              <ArrowUpRight className="h-3.5 w-3.5 text-zinc-400" />
            </div>
            <div>
              <div className="flex items-baseline gap-1" data-numeric>
                <span className={`font-black leading-none ${isError ? 'text-sm text-amber-300' : 'text-2xl'}`}>
                  {productionDisplay}
                </span>
                {!isError && <span className="text-[10px] text-zinc-400">حبة</span>}
              </div>
              <div className="text-[10px] text-zinc-400 mt-1">
                {isError ? 'اضغط للمحاولة مرة أخرى ›' : 'اضغط لعرض جدول الأيام ›'}
              </div>
            </div>
          </Link>

          {/* نسبة الهدر — color-adaptive */}
          <div
            className={`snap-start flex-shrink-0 w-[42%] rounded-2xl p-3.5 border min-h-[104px] flex flex-col justify-between ${
              wastePct < 5 ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'
            }`}
          >
            <div className={`text-[10px] font-semibold ${wastePct < 5 ? 'text-emerald-700' : 'text-amber-700'}`}>
              نسبة الهدر
            </div>
            <div>
              <div className={`text-2xl font-black leading-none ${wastePct < 5 ? 'text-emerald-900' : 'text-amber-900'}`} data-numeric>
                {isLoading ? '—' : `${wastePct.toFixed(1)}%`}
              </div>
              <div className={`text-[10px] mt-1 ${wastePct < 5 ? 'text-emerald-700' : 'text-amber-700'}`}>
                {wastePct < 5 ? '✓ ضمن الحدود' : '! يحتاج مراجعة'}
              </div>
            </div>
          </div>

          {/* الحضور */}
          <div className="snap-start flex-shrink-0 w-[42%] rounded-2xl p-3.5 bg-blue-50 border border-blue-200 min-h-[104px] flex flex-col justify-between">
            <div className="text-[10px] font-semibold text-blue-700 flex items-center gap-1">
              <UserCheck className="h-3 w-3" /> الحضور
            </div>
            <div>
              <div className="text-2xl font-black leading-none text-blue-900" data-numeric>
                {isLoading ? '—' : (
                  <>
                    {hr.present ?? 0}
                    <span className="opacity-50 text-sm">/{hr.total ?? 0}</span>
                  </>
                )}
              </div>
              <div className="text-[10px] text-blue-700 mt-1">
                {(hr.late ?? 0) > 0 ? `${hr.late} تأخير` : 'مكتمل'}
              </div>
            </div>
          </div>
        </div>

        {/* Detail lists — Inventory + Licenses */}
        <div className="text-[10px] font-bold text-zinc-500 px-1 pt-1">التفاصيل</div>

        <MobileListCard
          href="/inventory"
          icon={<Boxes className="h-4 w-4" />}
          iconClass="text-emerald-600 bg-emerald-50"
          title="المخزون"
        >
          <MobileRow label="إجمالي الأصناف" value={inv.itemsCount ?? 0} loading={isLoading} />
          <MobileRow
            label="منخفض"
            value={inv.lowStockCount ?? 0}
            loading={isLoading}
            warning={(inv.lowStockCount ?? 0) > 0}
          />
          <MobileRow
            label="قارب الانتهاء"
            value={inv.expiringBatches ?? 0}
            loading={isLoading}
            warning={(inv.expiringBatches ?? 0) > 0}
          />
        </MobileListCard>

        <MobileListCard
          href="/licenses"
          icon={<ScrollText className="h-4 w-4" />}
          iconClass="text-blue-600 bg-blue-50"
          title="الرخص"
        >
          <MobileRow label="إجمالي" value={lic.total ?? 0} loading={isLoading} />
          <MobileRow
            label="قاربت على الانتهاء"
            value={lic.expiring ?? 0}
            loading={isLoading}
            warning={(lic.expiring ?? 0) > 0}
          />
          <MobileRow
            label="منتهية"
            value={lic.expired ?? 0}
            loading={isLoading}
            danger={(lic.expired ?? 0) > 0}
          />
        </MobileListCard>

        {/* Quick tiles — surface the everyday pages that also live in "More" */}
        <div className="text-[10px] font-bold text-zinc-500 px-1 pt-1">اختصارات</div>
        <div className="grid grid-cols-2 gap-2">
          <MobileTile
            href="/orders"
            icon={<ShoppingCart className="h-4 w-4" />}
            iconClass="text-amber-700 bg-amber-50"
            label="الطلبيات"
            value={isLoading ? '—' : formatNumber(orderCount)}
            sub="طلبية"
          />
          <MobileTile
            href="/customers"
            icon={<Users className="h-4 w-4" />}
            iconClass="text-violet-600 bg-violet-50"
            label="العملاء"
            value={isLoading ? '—' : formatNumber(customerCount)}
            sub="عميل"
          />
        </div>
      </div>
    </div>
  );
}

function MobileListCard({
  href, icon, iconClass, title, children,
}: {
  href: string;
  icon: React.ReactNode;
  iconClass: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={`فتح ${title}`}
      className="block bg-white rounded-2xl border border-zinc-200 overflow-hidden active:bg-zinc-50 transition-colors"
      style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}
    >
      <div className="flex items-center justify-between px-3 py-3 border-b border-zinc-100 min-h-[48px]">
        <span className="flex items-center gap-2 text-sm font-bold text-zinc-900">
          <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${iconClass}`}>{icon}</span>
          {title}
        </span>
        <ChevronLeft className="h-4 w-4 text-zinc-400" />
      </div>
      <div>{children}</div>
    </Link>
  );
}

function MobileRow({
  label, value, warning, danger, loading,
}: {
  label: string;
  value: any;
  warning?: boolean;
  danger?: boolean;
  loading?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-100 last:border-0 text-sm">
      <span className="text-zinc-600">{label}</span>
      <span
        data-numeric
        className={
          loading ? 'font-bold text-zinc-400' :
          danger  ? 'font-bold text-red-600' :
          warning ? 'font-bold text-amber-700' :
          'font-bold text-zinc-900'
        }
      >
        {loading ? '—' : value}
      </span>
    </div>
  );
}

function MobileTile({
  href, icon, iconClass, label, value, sub,
}: {
  href: string;
  icon: React.ReactNode;
  iconClass: string;
  label: string;
  value: string | number;
  sub: string;
}) {
  return (
    <Link
      href={href}
      className="bg-white rounded-2xl border border-zinc-200 p-3 active:scale-[0.97] active:bg-zinc-50 transition-all block min-h-[92px]"
      style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}
    >
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center mb-2 ${iconClass}`}>
        {icon}
      </div>
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className="text-xl font-black text-zinc-900 leading-tight mt-0.5" data-numeric>{value}</div>
      <div className="text-[10px] text-zinc-400 mt-0.5">{sub}</div>
    </Link>
  );
}

/* ─── Desktop-only helpers — UNCHANGED ─── */
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
