'use client';

import { Sidebar, MobileBottomNav } from './sidebar';
import { AuthGuard } from './auth-guard';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="flex min-h-screen bg-zinc-50 overflow-x-hidden">
        <Sidebar />
        {/* min-w-0 يمنع الجداول الواسعة من توسيع الـ main خارج إطار الموبايل */}
        <main className="flex-1 min-w-0 overflow-x-hidden pb-20 md:pb-0">{children}</main>
        <MobileBottomNav />
      </div>
    </AuthGuard>
  );
}
