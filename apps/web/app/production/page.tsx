'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  Plus,
  Calendar,
  XCircle,
  Search,
  Printer,
  Filter,
  Settings2,
  Pencil,
  Trash2,
} from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, Button, Input, Badge } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/api';
import { formatDate, cn } from '@/lib/utils';

export default function DailyProductionListPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [showMachines, setShowMachines] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'DRAFT' | 'POSTED' | 'CANCELLED'
  >('all');

  const { data: records } = useQuery({
    queryKey: ['daily-production'],
    queryFn: () => api.get('/daily-production').then((r) => r.data),
  });

  const { data: machines } = useQuery({
    queryKey: ['machines'],
    queryFn: () => api.get('/machines').then((r) => r.data),
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
        String(r.machineNumber ?? ''),
        r.status,
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [records, search, statusFilter]);

  // ─── Quick totals helper (compatible مع الـ schema الجديدة) ──
  const computeTotals = (r: any) => {
    const cartons = (r.produced ?? []).reduce(
      (s: number, p: any) => s + Number(p.cartonsTotal || 0),
      0,
    );
    const waste = (r.wastages ?? []).reduce(
      (s: number, w: any) => s + Number(w.quantity || 0),
      0,
    );
    return { cartons, waste };
  };

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight">
              الإنتاج اليومي
            </h1>
            <p className="text-sm text-zinc-500 mt-0.5">
              ورقة الإنتاج اليومية — 3 ماكينات
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setShowMachines(true)}>
              <Settings2 className="h-4 w-4" />
              إدارة الماكينات
            </Button>
            <Button onClick={() => setShowNew(true)}>
              <Plus className="h-4 w-4" />
              يوم إنتاج جديد
            </Button>
          </div>
        </header>

        {showNew && (
          <NewProductionDayForm
            machines={machines ?? []}
            onClose={() => setShowNew(false)}
            onCreated={(id) => {
              qc.invalidateQueries({ queryKey: ['daily-production'] });
              router.push(`/production/${id}`);
            }}
          />
        )}

        {showMachines && <MachineManagerModal onClose={() => setShowMachines(false)} />}

        {/* ─── Search + Filter Bar ───────────────────── */}
        <Card className="p-3 flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث: تاريخ، شيفت، مشغّل، ماكينة..."
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
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">
                      التاريخ
                    </th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">
                      الشيفت
                    </th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">
                      المشغّل
                    </th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">
                      الماكينة
                    </th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">
                      الإنتاج
                    </th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">
                      التوالف
                    </th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">
                      الحالة
                    </th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">
                      إجراء
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r: any) => {
                    const { cartons, waste } = computeTotals(r);
                    return (
                      <tr
                        key={r.id}
                        className="border-b border-zinc-100 hover:bg-zinc-50"
                      >
                        <td
                          className="p-3 font-bold cursor-pointer"
                          onClick={() => router.push(`/production/${r.id}`)}
                        >
                          {formatDate(r.productionDate)}
                        </td>
                        <td
                          className="p-3 text-zinc-600 cursor-pointer"
                          onClick={() => router.push(`/production/${r.id}`)}
                        >
                          {r.shift || '-'}
                        </td>
                        <td
                          className="p-3 text-zinc-600 cursor-pointer"
                          onClick={() => router.push(`/production/${r.id}`)}
                        >
                          {r.operatorName || '-'}
                        </td>
                        <td
                          className="p-3 text-zinc-600 cursor-pointer"
                          data-numeric
                          onClick={() => router.push(`/production/${r.id}`)}
                        >
                          {r.machineNumber || '-'}
                        </td>
                        <td
                          className="p-3 font-bold cursor-pointer"
                          data-numeric
                          onClick={() => router.push(`/production/${r.id}`)}
                        >
                          {cartons.toLocaleString('en-US')}
                        </td>
                        <td
                          className={cn(
                            'p-3 cursor-pointer',
                            waste > 0 && 'text-amber-600 font-bold',
                          )}
                          data-numeric
                          onClick={() => router.push(`/production/${r.id}`)}
                        >
                          {waste.toLocaleString('en-US')}
                        </td>
                        <td
                          className="p-3 cursor-pointer"
                          onClick={() => router.push(`/production/${r.id}`)}
                        >
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
                        <td className="p-3">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(
                                `/production/${r.id}/print`,
                                '_blank',
                                'noopener',
                              );
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-zinc-200 hover:bg-zinc-100"
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

function NewProductionDayForm({
  onClose,
  onCreated,
  machines,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
  machines: any[];
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    productionDate: today,
    shift: '',
    operatorName: '',
    machineNumber: '' as string,
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
        machineNumber: form.machineNumber ? +form.machineNumber : undefined,
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
        <div className="grid md:grid-cols-2 gap-4">
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
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-zinc-700">رقم الماكينة</label>
            <select
              value={form.machineNumber}
              onChange={(e) => setForm({ ...form, machineNumber: e.target.value })}
              className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
            >
              <option value="">— غير محدد —</option>
              {machines.map((m: any) => (
                <option key={m.id} value={m.number}>
                  {m.name} (#{m.number})
                </option>
              ))}
            </select>
          </div>
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

// ─── إدارة الماكينات (إضافة/تعديل/حذف) ───────────────────
function MachineManagerModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [newNumber, setNewNumber] = useState('');
  const [newName, setNewName] = useState('');

  const { data: machines, isLoading } = useQuery({
    queryKey: ['machines'],
    queryFn: () => api.get('/machines').then((r) => r.data),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['machines'] });

  const add = useMutation({
    mutationFn: (body: { number: number; name: string }) =>
      api.post('/machines', body).then((r) => r.data),
    onSuccess: () => {
      toast.success('تمت إضافة الماكينة');
      setNewNumber('');
      setNewName('');
      refresh();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'تعذّرت الإضافة'),
  });

  const update = useMutation({
    mutationFn: ({ id, ...body }: any) =>
      api.patch(`/machines/${id}`, body).then((r) => r.data),
    onSuccess: () => {
      toast.success('تم تعديل الماكينة');
      refresh();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'تعذّر التعديل'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/machines/${id}`).then((r) => r.data),
    onSuccess: () => {
      toast.success('تم حذف الماكينة');
      refresh();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'تعذّر الحذف'),
  });

  const submitNew = (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseInt(newNumber, 10);
    if (isNaN(n) || n <= 0) return toast.error('أدخل رقم ماكينة صحيحاً');
    add.mutate({ number: n, name: newName.trim() || `ماكينة ${n}` });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-zinc-100 sticky top-0 bg-white">
          <h3 className="font-bold flex items-center gap-2">
            <Settings2 className="h-5 w-5" /> إدارة الماكينات
          </h3>
          <button onClick={onClose}>
            <XCircle className="h-5 w-5 text-zinc-400" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <form onSubmit={submitNew} className="grid grid-cols-12 gap-2 items-end rounded-xl bg-zinc-50 border border-zinc-100 p-3">
            <div className="col-span-3">
              <label className="text-[10px] font-bold text-zinc-500 uppercase">الرقم</label>
              <input
                type="number"
                value={newNumber}
                onChange={(e) => setNewNumber(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm mt-1"
                placeholder="4"
              />
            </div>
            <div className="col-span-6">
              <label className="text-[10px] font-bold text-zinc-500 uppercase">الاسم</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm mt-1"
                placeholder="ماكينة التعبئة 4"
              />
            </div>
            <div className="col-span-3">
              <Button type="submit" className="w-full" loading={add.isPending}>
                <Plus className="h-4 w-4" /> إضافة
              </Button>
            </div>
          </form>

          {isLoading ? (
            <p className="text-sm text-zinc-500 text-center py-4">جاري التحميل...</p>
          ) : !machines || machines.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-6">لا توجد ماكينات</p>
          ) : (
            <div className="space-y-2">
              {machines.map((m: any) => (
                <MachineRow
                  key={m.id}
                  machine={m}
                  onSave={(name, number) => update.mutate({ id: m.id, name, number })}
                  onDelete={() => {
                    if (!confirm(`حذف ${m.name}؟`)) return;
                    remove.mutate(m.id);
                  }}
                  busy={update.isPending || remove.isPending}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MachineRow({
  machine,
  onSave,
  onDelete,
  busy,
}: {
  machine: any;
  onSave: (name: string, number: number) => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(machine.name);
  const [number, setNumber] = useState(String(machine.number));

  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-100 p-2.5">
      {editing ? (
        <>
          <input
            type="number"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            className="w-16 h-8 px-2 rounded border border-zinc-200 text-sm"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 h-8 px-2 rounded border border-zinc-200 text-sm"
          />
          <Button
            size="sm"
            loading={busy}
            onClick={() => {
              const n = parseInt(number, 10);
              if (isNaN(n) || n <= 0) return;
              onSave(name.trim() || machine.name, n);
              setEditing(false);
            }}
          >
            حفظ
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            إلغاء
          </Button>
        </>
      ) : (
        <>
          <span className="w-10 font-mono text-sm font-bold">#{machine.number}</span>
          <span className="flex-1 text-sm">{machine.name}</span>
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-red-600 border-red-200 hover:bg-red-50"
            onClick={onDelete}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </>
      )}
    </div>
  );
}
