'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History, Plus, Pencil, Trash2, Search } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, Badge } from '@/components/ui';
import { api } from '@/lib/api';

const ACTION_META: Record<string, { label: string; cls: string; Icon: any }> = {
  POST: { label: 'إضافة', cls: 'bg-emerald-50 text-emerald-700', Icon: Plus },
  PATCH: { label: 'تعديل', cls: 'bg-blue-50 text-blue-700', Icon: Pencil },
  PUT: { label: 'تعديل', cls: 'bg-blue-50 text-blue-700', Icon: Pencil },
  DELETE: { label: 'حذف', cls: 'bg-red-50 text-red-700', Icon: Trash2 },
};

function resourceLabel(path: string): string {
  const p = (path || '').toLowerCase();
  if (p.includes('daily-production')) return 'الإنتاج اليومي';
  if (p.includes('inventory')) return 'المخزون';
  if (p.includes('orders')) return 'الطلبيات';
  if (p.includes('customers')) return 'العملاء';
  if (p.includes('employees')) return 'الموظفين';
  if (p.includes('finance')) return 'المالية';
  if (p.includes('licenses')) return 'الرخص';
  if (p.includes('repack')) return 'إعادة التعبئة';
  return path;
}

export default function ActivityPage() {
  const [search, setSearch] = useState('');

  const { data: logs, isLoading, error } = useQuery({
    queryKey: ['audit-logs'],
    queryFn: () => api.get('/audit-logs', { params: { limit: 200 } }).then((r) => r.data),
    refetchInterval: 60_000,
  });

  const filtered = (logs ?? []).filter((l: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (l.actorName ?? '').toLowerCase().includes(q) ||
      resourceLabel(l.resource).toLowerCase().includes(q)
    );
  });

  const fmt = (d: string) =>
    new Date(d).toLocaleString('ar-EG', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto p-3 md:p-6 space-y-4 md:space-y-6 pb-24 md:pb-6">
        <header className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-zinc-900 text-white flex items-center justify-center">
            <History className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight">سجل العمليات</h1>
            <p className="text-sm text-zinc-500 mt-0.5">تتبّع كل إضافة وتعديل وحذف — من قام بها ومتى</p>
          </div>
        </header>

        <Card className="p-3">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث: مستخدم أو قسم..."
              className="w-full h-10 pr-9 pl-3 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
            />
          </div>
        </Card>

        <Card>
          {isLoading ? (
            <div className="p-8 text-center text-zinc-500">جاري التحميل...</div>
          ) : error ? (
            <div className="p-8 text-center text-amber-600 text-sm">
              لا تملك صلاحية عرض سجل العمليات (للمدراء فقط).
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center">
              <History className="h-12 w-12 mx-auto text-zinc-300 mb-3" />
              <p className="text-zinc-500">لا توجد عمليات مسجّلة بعد</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 border-b border-zinc-200">
                  <tr>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">العملية</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">القسم</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">المستخدم</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">IP / الجهاز</th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">الوقت</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((l: any) => {
                    const meta = ACTION_META[l.action] ?? {
                      label: l.action,
                      cls: 'bg-zinc-100 text-zinc-700',
                      Icon: History,
                    };
                    const Icon = meta.Icon;
                    // مختصر للـ user-agent
                    const uaShort = (() => {
                      const ua = String(l.userAgent ?? '');
                      if (!ua) return '';
                      if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
                      if (ua.includes('Android')) return 'Android';
                      if (ua.includes('Mac OS X')) return 'macOS';
                      if (ua.includes('Windows')) return 'Windows';
                      if (ua.includes('Linux')) return 'Linux';
                      return 'متصفح';
                    })();
                    return (
                      <tr key={l.id} className="border-b border-zinc-100 hover:bg-zinc-50">
                        <td className="p-3">
                          <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-bold ${meta.cls}`}>
                            <Icon className="h-3 w-3" />
                            {meta.label}
                          </span>
                        </td>
                        <td className="p-3 font-medium">{resourceLabel(l.resource)}</td>
                        <td className="p-3">
                          <div className="font-medium">{l.actorName}</div>
                          {l.actorEmail && (
                            <div className="text-[11px] text-zinc-400">{l.actorEmail}</div>
                          )}
                        </td>
                        <td className="p-3 text-xs text-zinc-500" title={l.userAgent ?? ''}>
                          {l.ip ? <div className="font-mono">{l.ip}</div> : <span className="text-zinc-300">—</span>}
                          {uaShort && <div className="text-[10px] text-zinc-400">{uaShort}</div>}
                        </td>
                        <td className="p-3 text-zinc-500" data-numeric>{fmt(l.occurredAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
