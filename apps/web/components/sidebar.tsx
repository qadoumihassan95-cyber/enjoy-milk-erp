'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
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

// Mobile bottom nav
export function MobileBottomNav() {
  const pathname = usePathname();
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-zinc-200 z-30">
      <div className="grid grid-cols-5">
        {NAV.slice(0, 5).map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname?.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center justify-center gap-1 py-3 transition',
                active ? 'text-zinc-900' : 'text-zinc-500',
              )}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-semibold">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
