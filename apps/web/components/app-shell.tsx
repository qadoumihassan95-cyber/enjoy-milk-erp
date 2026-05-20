'use client';

import { Sidebar, MobileBottomNav } from './sidebar';
import { AuthGuard } from './auth-guard';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="flex min-h-screen bg-zinc-50">
        <Sidebar />
        <main className="flex-1 pb-20 md:pb-0">{children}</main>
        <MobileBottomNav />
      </div>
    </AuthGuard>
  );
}
