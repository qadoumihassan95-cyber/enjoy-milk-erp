'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Calendar,
  XCircle,
  Search,
  Printer,
  Filter,
  Factory,
  ChevronLeft,
} from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, Button, Input, Badge } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, cn } from '@/lib/utils';

/**
 * جدول أيام الإنتاج — احترافي وقابل للنقر.
 * الأعمدة المطلوبة: التاريخ | رقم يوم الإنتاج | عدد التشغيلات | إجمالي الإنتاج | نسبة الهدر | المشغّل | الحالة
 * كل صف يفتح صفحة تفاصيل ذلك اليوم.
 */
export default function DailyProductionListPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'DRAFT' | 'POSTED' | 'CANCELLED'
  >('all');

  const { data: records } = useQuery({
    queryKey: ['daily-production'],
    queryFn: () => api.get('/daily-production').then((r) => r.data),
  });

  // ─── Filtering ─────────────────────────────────
  const filtered = useMemo(() => {
    if (!records) return [];
    const q = search.trim().toLowerCase();
    return records.filter((r: any) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!q) return true;
      const hay = [
        formatDate(r.productionDate),
        r.shift ?? '',
        r.operatorName ?? '',
        r.status,
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [records, search, statusFilter]);

  // ─── ترتيب تصاعدي حسب التاريخ لحساب "رقم يوم الإنتاج" ─────
  const dayNumberMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!records) return map;
    const sorted = [...records].sort(
      (a, b) =>
        new Date(a.productionDate).getTime() -
        new Date(b.productionDate).getTime(),
    );
    sorted.forEach((r: any, idx) => map.set(r.id, idx + 1));
    return map;
  }, [records]);

  // ─── Totals helper ────────────────────────────
  const computeTotals = (r: any) => {
    const cartons = (r.produced ?? []).reduce(
      (s: number, p: any) => s + Number(p.cartonsTotal || 0),
      0,
    );
    const waste = (r.wastages ?? []).reduce(
      (s: number, w: any) => s + Number(w.quantity || 0),
      0,
    );
    const runs = (r.produced ?? []).length;
    const total = cartons + waste;
    const wastePct = total > 0 ? (waste / total) * 100 : 0;
    return { cartons, waste, runs, wastePct };
  };

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/dashboard')}
              className="text-zinc-500 hover:text-zinc-900 transition-colors"
              title="رجوع للداشبورد"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div className="w-10 h-10 rounded-xl bg-zinc-900 text-white flex items-center justify-center">
              <Factory className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-black tracking-tight">
                جدول أيام الإنتاج
              </h1>
              <p className="text-sm text-zinc-500 mt-0.5">
                اضغط على أي يوم لعرض التفاصيل الكاملة
              </p>
            </div>
          </div>
          <Button onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4" />
            يوم إنتاج جديد
          </Button>
        </header>

        {showNew && (
          <NewProductionDayForm
            onClose={() => setShowNew(false)}
            onCreated={(id) => {
              qc.invalidateQueries({ queryKey: ['daily-production'] });
              router.push(`/production/${id}`);
            }}
          />
        )}

        {/* ─── Search + Filter Bar ───────────────────── */}
        <Card className="p-3 flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث: تاريخ، شيفت، مشغّل..."
              className="w-full h-10 pr-9 pl-3 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-400"
            />
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Filter className="h-4 w-4 text-zinc-400" />
            {[
              { v: 'all', l: 'الكل' },
              { v: 'DRAFT', l: 'مسودة' },
              { v: 'POSTED', l: 'مُرحَّل' },
              { v: 'CANCELLED', l: 'ملغي' },
            ].map((s) => (
              <button
                key={s.v}
                onClick={() => setStatusFilter(s.v as any)}
                className={cn(
                  'px-3 py-1.5 rounded-md text-xs font-bold transition-colors',
                  statusFilter === s.v
                    ? 'bg-zinc-900 text-white'
                    : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200',
                )}
              >
                {s.l}
              </button>
            ))}
          </div>
          <div className="text-xs text-zinc-500" data-numeric>
            {filtered.length} / {records?.length ?? 0}
          </div>
        </Card>

        <Card>
          {!records || records.length === 0 ? (
            <div className="p-12 text-center">
              <Calendar className="h-12 w-12 mx-auto text-zinc-300 mb-3" />
              <p className="text-zinc-500">لا توجد سجلات إنتاج</p>
              <p className="text-xs text-zinc-400 mt-1">
                ابدأ بإنشاء يوم إنتاج جديد
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center">
              <Search className="h-12 w-12 mx-auto text-zinc-300 mb-3" />
              <p className="text-zinc-500">لا توجد نتائج مطابقة</p>
              <button
                onClick={() => {
                  setSearch('');
                  setStatusFilter('all');
                }}
                className="text-xs text-zinc-700 underline mt-2"
              >
                مسح الفلاتر
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 border-b">
                  <tr>
                    <Th>التاريخ</Th>
                    <Th>رقم يوم الإنتاج</Th>
                    <Th>عدد التشغيلات</Th>
                    <Th>إجمالي الإنتاج</Th>
                    <Th>نسبة الهدر</Th>
                    <Th>المشغّل</Th>
                    <Th>الحالة</Th>
                    <Th>إجراء</Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r: any) => {
                    const { cartons, waste, runs, wastePct } = computeTotals(r);
                    const dayNo = dayNumberMap.get(r.id) ?? '-';
                    return (
                      <tr
                        key={r.id}
                        onClick={() => router.push(`/production/${r.id}`)}
                        className="border-b border-zinc-100 hover:bg-zinc-50 cursor-pointer transition-colors group"
                      >
                        <td className="p-3 font-bold group-hover:text-zinc-900">
                          {formatDate(r.productionDate)}
                        </td>
                        <td className="p-3 font-mono text-xs">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-700 font-bold">
                            #{dayNo}
                          </span>
                        </td>
                        <td className="p-3 font-bold" data-numeric>
                          {runs}
                        </td>
                        <td className="p-3 font-bold text-emerald-700" data-numeric>
                          {cartons.toLocaleString('en-US')}
                        </td>
                        <td
                          className={cn(
                            'p-3 font-bold',
                            wastePct > 5
                              ? 'text-red-600'
                              : wastePct > 2
                              ? 'text-amber-600'
                              : 'text-zinc-500',
                          )}
                          data-numeric
                        >
                          {wastePct.toFixed(1)}%
                        </td>
                        <td className="p-3 text-zinc-600">
                          {r.operatorName || '-'}
                        </td>
                        <td className="p-3">
                          {r.status === 'POSTED' ? (
                            <Badge variant="success" dot>
                              مُرحَّل
                            </Badge>
                          ) : r.status === 'CANCELLED' ? (
                            <Badge variant="danger" dot>
                              ملغي
                            </Badge>
                          ) : (
                            <Badge variant="warning" dot>
                              مسودة
                            </Badge>
                          )}
                        </td>
                        <td className="p-3" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() =>
                              window.open(
                                `/production/${r.id}/print`,
                                '_blank',
                                'noopener',
                              )
                            }
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-zinc-200 hover:bg-zinc-100 transition-colors"
                            title="طباعة PDF"
                          >
                            <Printer className="h-3 w-3" /> طباعة
                          </button>
                        </td>
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

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase whitespace-nowrap">
      {children}
    </th>
  );
}

function NewProductionDayForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    productionDate: today,
    shift: '',
    operatorName: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      const res = await api.post('/daily-production', {
        productionDate: form.productionDate,
        shift: form.shift || undefined,
        operatorName: form.operatorName || undefined,
      });
      onCreated(res.data.id);
      onClose();
    } catch (e: any) {
      setErr(e?.response?.data?.message || 'فشل الإنشاء');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-bold">يوم إنتاج جديد</h3>
        <button onClick={onClose} className="text-zinc-400">
          <XCircle className="h-5 w-5" />
        </button>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid md:grid-cols-3 gap-4">
          <Input
            label="التاريخ *"
            type="date"
            value={form.productionDate}
            onChange={(e) => setForm({ ...form, productionDate: e.target.value })}
            required
          />
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-zinc-700">الشيفت</label>
            <select
              value={form.shift}
              onChange={(e) => setForm({ ...form, shift: e.target.value })}
              className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
            >
              <option value="">— اختر —</option>
              <option value="صباحي">صباحي</option>
              <option value="مسائي">مسائي</option>
              <option value="ليلي">ليلي</option>
            </select>
          </div>
          <Input
            label="اسم المشغّل"
            value={form.operatorName}
            onChange={(e) => setForm({ ...form, operatorName: e.target.value })}
          />
        </div>
        {err && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            {err}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit" loading={saving}>
            إنشاء
          </Button>
        </div>
      </form>
    </Card>
  );
}
