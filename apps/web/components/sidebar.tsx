'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Package,
  Repeat,
  Wallet,
  Users,
  ShoppingBag,
  FileBadge2,
  LogOut,
  Settings,
  History,
  Banknote,
  Send,
  MoreHorizontal,
  X,
  ChevronLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

const NAV = [
  { href: '/dashboard', label: 'اليوم', icon: LayoutDashboard },
  { href: '/production', label: 'الإنتاج اليومي', icon: Repeat },
  { href: '/production/summary', label: 'ملخص إنتاج اليوم', icon: Repeat },
  { href: '/orders', label: 'الطلبيات', icon: ShoppingBag },
  { href: '/inventory', label: 'المخزون', icon: Package },
  { href: '/reports', label: 'التقارير', icon: FileBadge2 },
  { href: '/customers', label: 'العملاء', icon: ShoppingBag },
  { href: '/finance', label: 'المالية', icon: Wallet },
  { href: '/employees', label: 'الموظفون', icon: Users },
  { href: '/payroll', label: 'الرواتب', icon: Banknote },
  { href: '/licenses', label: 'الرخص', icon: FileBadge2 },
  { href: '/telegram', label: 'إدارة التليغرام', icon: Send },
  { href: '/activity', label: 'سجل العمليات', icon: History },
  { href: '/settings', label: 'الإعدادات', icon: Settings },
];

/* ═════════════════════════════════════════════════════════════════════
   DESKTOP SIDEBAR — visually unchanged.
   Hidden on mobile via `hidden md:flex` (was the same before).
════════════════════════════════════════════════════════════════════════ */
export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuthStore();

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  return (
    <aside className="hidden md:flex flex-col w-60 bg-white border-l border-zinc-200">
      <div className="px-4 py-4 border-b border-zinc-100">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-zinc-900 flex items-center justify-center text-white font-black text-sm">
            EM
          </div>
          <span className="font-bold text-sm">Enjoy Milk</span>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname?.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors',
                active
                  ? 'bg-zinc-100 text-zinc-900 font-bold'
                  : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-zinc-100 p-3 space-y-2">
        <div className="flex items-center gap-2.5 p-2 rounded-md bg-zinc-50">
          <div className="w-8 h-8 rounded-full bg-zinc-200 text-zinc-700 font-bold flex items-center justify-center text-xs">
            {user?.fullName?.[0] ?? '?'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-xs truncate">{user?.fullName}</div>
            <div className="text-[10px] text-zinc-500 truncate">{user?.role}</div>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs text-zinc-600 hover:bg-zinc-50 hover:text-red-600 transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" />
          تسجيل الخروج
        </button>
      </div>
    </aside>
  );
}

/* ═════════════════════════════════════════════════════════════════════
   MOBILE BOTTOM NAV — new 5-tab layout: اليوم · الإنتاج · الطلبيات ·
   المخزون · المزيد. Fifth tab opens a full-screen "More" sheet that
   surfaces every desktop link (Reports, Customers, Finance, Employees,
   Payroll, Licenses, Telegram, Activity, Settings, Production summary)
   plus logout. Nothing from the desktop is hidden from mobile users.

   `md:hidden` guard keeps this OFF the desktop layout.
════════════════════════════════════════════════════════════════════════ */
const PRIMARY_TABS = [
  { href: '/dashboard',  label: 'اليوم',    icon: LayoutDashboard },
  { href: '/production', label: 'الإنتاج',  icon: Repeat },
  { href: '/orders',     label: 'الطلبيات', icon: ShoppingBag },
  { href: '/inventory',  label: 'المخزون',  icon: Package },
] as const;

const SECONDARY_TABS_ORDER = [
  '/reports',
  '/customers',
  '/finance',
  '/employees',
  '/payroll',
  '/licenses',
  '/telegram',
  '/activity',
  '/production/summary',
  '/settings',
];

export function MobileBottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const [moreOpen, setMoreOpen] = useState(false);

  // Lock body scroll while the sheet is open.
  useEffect(() => {
    if (!moreOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [moreOpen]);

  // Auto-close on route change.
  useEffect(() => { setMoreOpen(false); }, [pathname]);

  const isPrimary = (href: string) =>
    pathname === href || pathname?.startsWith(href + '/');

  const anyPrimaryActive = PRIMARY_TABS.some((t) => isPrimary(t.href));

  const handleLogout = () => {
    setMoreOpen(false);
    logout();
    router.push('/login');
  };

  const secondaryLinks = SECONDARY_TABS_ORDER
    .map((href) => NAV.find((n) => n.href === href))
    .filter((n): n is (typeof NAV)[number] => Boolean(n));

  return (
    <>
      {/* Bottom bar — safe-area aware */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-zinc-200 z-30"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        dir="rtl"
      >
        <div className="grid grid-cols-5">
          {PRIMARY_TABS.map((item) => {
            const Icon = item.icon;
            const active = isPrimary(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center justify-center gap-1 py-2.5 min-h-[52px] transition-colors active:bg-zinc-50',
                  active ? 'text-zinc-900' : 'text-zinc-500',
                )}
              >
                <Icon className={cn('h-5 w-5', active && 'stroke-[2.5]')} />
                <span className="text-[10px] font-semibold leading-none">{item.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-label="المزيد"
            aria-expanded={moreOpen}
            className={cn(
              'flex flex-col items-center justify-center gap-1 py-2.5 min-h-[52px] transition-colors active:bg-zinc-50',
              moreOpen || !anyPrimaryActive ? 'text-zinc-900' : 'text-zinc-500',
            )}
          >
            <MoreHorizontal className={cn('h-5 w-5', (moreOpen || !anyPrimaryActive) && 'stroke-[2.5]')} />
            <span className="text-[10px] font-semibold leading-none">المزيد</span>
          </button>
        </div>
      </nav>

      {/* Full-screen "More" sheet */}
      {moreOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 flex items-end"
          role="dialog"
          aria-modal="true"
          aria-label="القائمة الكاملة"
          dir="rtl"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
            onClick={() => setMoreOpen(false)}
          />

          {/* Sheet */}
          <div
            className="relative w-full max-h-[92vh] bg-white rounded-t-2xl flex flex-col shadow-2xl animate-in slide-in-from-bottom duration-200"
            style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
          >
            {/* Grabber */}
            <div className="pt-2 pb-1 flex justify-center">
              <div className="h-1 w-10 rounded-full bg-zinc-300" />
            </div>

            {/* Header */}
            <div className="px-4 py-3 flex items-center justify-between border-b border-zinc-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-zinc-100 text-zinc-700 font-black flex items-center justify-center text-sm">
                  {user?.fullName?.[0] ?? '?'}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-zinc-900 truncate">
                    {user?.fullName ?? 'المستخدم'}
                  </div>
                  <div className="text-[11px] text-zinc-500 truncate">
                    {user?.role ?? '—'}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setMoreOpen(false)}
                aria-label="إغلاق"
                className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-zinc-100 active:bg-zinc-200"
              >
                <X className="h-5 w-5 text-zinc-700" />
              </button>
            </div>

            {/* Section title */}
            <div className="px-4 pt-3 pb-1 text-[10px] font-bold text-zinc-500 tracking-wide">
              كل الأقسام
            </div>

            {/* Links grid */}
            <div className="flex-1 overflow-y-auto px-3 pb-2">
              <div className="grid grid-cols-1 gap-1">
                {secondaryLinks.map((item) => {
                  const Icon = item.icon;
                  const active = pathname === item.href || pathname?.startsWith(item.href + '/');
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMoreOpen(false)}
                      className={cn(
                        'flex items-center gap-3 px-3 py-3 rounded-xl min-h-[48px] transition-colors',
                        active
                          ? 'bg-zinc-900 text-white'
                          : 'text-zinc-800 active:bg-zinc-100',
                      )}
                    >
                      <span
                        className={cn(
                          'w-9 h-9 rounded-lg flex items-center justify-center',
                          active ? 'bg-white/15' : 'bg-zinc-100',
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="flex-1 text-sm font-semibold">{item.label}</span>
                      <ChevronLeft className={cn('h-4 w-4', active ? 'text-white/70' : 'text-zinc-400')} />
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* Footer — Logout */}
            <div className="border-t border-zinc-100 p-3">
              <button
                onClick={handleLogout}
                className="w-full flex items-center justify-center gap-2 px-3 py-3 min-h-[48px] rounded-xl bg-red-50 text-red-700 font-bold text-sm active:bg-red-100"
              >
                <LogOut className="h-4 w-4" />
                تسجيل الخروج
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
