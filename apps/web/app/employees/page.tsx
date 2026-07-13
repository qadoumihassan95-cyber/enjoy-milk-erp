'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus, X, UserCheck, UserX, Clock, Timer, Pencil, Trash2, FileText } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Stat } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/api';
import { formatNumber } from '@/lib/utils';

export default function EmployeesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [otEmployee, setOtEmployee] = useState<any>(null);
  const [extraPayEmployee, setExtraPayEmployee] = useState<any>(null);

  const { data: employees } = useQuery({
    queryKey: ['employees'],
    queryFn: () => api.get('/employees').then((r) => r.data),
  });

  const { data: stats } = useQuery({
    queryKey: ['employees', 'stats'],
    queryFn: () => api.get('/employees/stats').then((r) => r.data),
    refetchInterval: 30_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['employees'] });
    qc.invalidateQueries({ queryKey: ['employees', 'stats'] });
  };

  const checkIn = useMutation({
    mutationFn: (id: string) => api.post(`/employees/${id}/check-in`).then((r) => r.data),
    onSuccess: () => {
      toast.success('تم تسجيل الحضور');
      invalidate();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'تعذّر تسجيل الحضور'),
  });

  // غياب / تأخير
  const mark = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.post(`/employees/${id}/attendance`, { status }).then((r) => r.data),
    onSuccess: (_d, vars) => {
      toast.success(vars.status === 'ABSENT' ? 'تم تسجيل الغياب' : 'تم تسجيل التأخير');
      invalidate();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'تعذّر تسجيل الحالة'),
  });

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight">الموظفون</h1>
            <p className="text-sm text-zinc-500 mt-0.5">{employees?.length ?? 0} موظف</p>
          </div>
          <Button onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4" />
            موظف جديد
          </Button>
        </header>

        <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Stat label="إجمالي الموظفين" value={stats?.total ?? 0} />
          <Stat label="حضور اليوم" value={stats?.present ?? 0} state="good" />
          <Stat label="تأخير" value={stats?.late ?? 0} state={(stats?.late ?? 0) > 0 ? 'warning' : 'good'} />
          <Stat label="غياب" value={stats?.absent ?? 0} state={(stats?.absent ?? 0) > 0 ? 'warning' : 'good'} />
          <Stat label="عمل إضافي (ساعة)" value={stats?.overtimeHours ?? 0} />
        </section>

        {showNew && (
          <NewEmployeeForm onClose={() => setShowNew(false)} onSaved={() => qc.invalidateQueries({ queryKey: ['employees'] })} />
        )}

        {editing && (
          <EditEmployeeForm
            employee={editing}
            onClose={() => setEditing(null)}
            onSaved={() => {
              toast.success('تم حفظ تعديلات الموظف');
              qc.invalidateQueries({ queryKey: ['employees'] });
              setEditing(null);
            }}
            onError={(m) => toast.error(m)}
          />
        )}

        {otEmployee && (
          <OvertimeModal
            employee={otEmployee}
            onClose={() => setOtEmployee(null)}
            onChanged={() => {
              qc.invalidateQueries({ queryKey: ['employees', 'stats'] });
              qc.invalidateQueries({ queryKey: ['payroll'] });
            }}
          />
        )}

        {extraPayEmployee && (
          <ExtraPaymentModal
            employee={extraPayEmployee}
            onClose={() => setExtraPayEmployee(null)}
            onSaved={() => {
              toast.success('تم تسجيل الدفعة الإضافية للشهر الحالي');
              setExtraPayEmployee(null);
              qc.invalidateQueries({ queryKey: ['payroll'] });
            }}
          />
        )}

        <Card>
          <CardHeader>
            <CardTitle>قائمة الموظفين</CardTitle>
          </CardHeader>
          <CardContent>
            {!employees || employees.length === 0 ? (
              <p className="text-sm text-zinc-500 text-center py-4">لا يوجد موظفون</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 border-b">
                    <tr>
                      <th className="text-right p-3 text-[10px] font-bold uppercase">
                        الكود
                      </th>
                      <th className="text-right p-3 text-[10px] font-bold uppercase">
                        الاسم
                      </th>
                      <th className="text-right p-3 text-[10px] font-bold uppercase">
                        القسم
                      </th>
                      <th className="text-right p-3 text-[10px] font-bold uppercase">
                        المنصب
                      </th>
                      <th className="text-right p-3 text-[10px] font-bold uppercase">
                        الراتب
                      </th>
                      <th className="text-right p-3 text-[10px] font-bold uppercase">
                        إجراء
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((e: any) => (
                      <tr key={e.id} className="border-b border-zinc-100 hover:bg-zinc-50">
                        <td className="p-3 font-mono text-xs">{e.code}</td>
                        <td className="p-3 font-medium">{e.fullName}</td>
                        <td className="p-3 text-zinc-600">{e.department || '-'}</td>
                        <td className="p-3 text-zinc-600">{e.position || '-'}</td>
                        <td className="p-3" data-numeric>
                          {e.baseSalary ? `${formatNumber(+e.baseSalary, 0)} د.أ` : '-'}
                        </td>
                        <td className="p-3">
                          <div className="flex gap-1.5 flex-wrap">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setEditing(e)}
                              className="text-zinc-700 border-zinc-200 hover:bg-zinc-100"
                            >
                              <Pencil className="h-3 w-3" />
                              تعديل
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => window.open(`/employees/${e.id}/documents`, '_blank')}
                              className="text-purple-700 border-purple-200 hover:bg-purple-50"
                              title="ملفات الموظف"
                            >
                              <FileText className="h-3 w-3" />
                              وثائق
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => checkIn.mutate(e.id)}
                              loading={checkIn.isPending && checkIn.variables === e.id}
                            >
                              <UserCheck className="h-3 w-3" />
                              حضور
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => mark.mutate({ id: e.id, status: 'ABSENT' })}
                              loading={mark.isPending && mark.variables?.id === e.id && mark.variables?.status === 'ABSENT'}
                              className="text-red-600 border-red-200 hover:bg-red-50"
                            >
                              <UserX className="h-3 w-3" />
                              غياب
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => mark.mutate({ id: e.id, status: 'LATE' })}
                              loading={mark.isPending && mark.variables?.id === e.id && mark.variables?.status === 'LATE'}
                              className="text-amber-600 border-amber-200 hover:bg-amber-50"
                            >
                              <Clock className="h-3 w-3" />
                              تأخير
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setExtraPayEmployee(e)}
                              className="text-blue-600 border-blue-200 hover:bg-blue-50"
                              title="إضافة دفعة/مكافأة بمبلغ + سبب"
                            >
                              <Timer className="h-3 w-3" />
                              دفعة إضافية
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setOtEmployee(e)}
                              className="text-zinc-600 border-zinc-200 hover:bg-zinc-50"
                              title="عمل إضافي بالساعات (بحسب الدوام)"
                            >
                              <Timer className="h-3 w-3" />
                              ساعات
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function NewEmployeeForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    fullName: '',
    nationalId: '',
    phone: '',
    department: '',
    position: '',
    baseSalary: '',
  });
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/employees', {
        ...form,
        baseSalary: +form.baseSalary || undefined,
      });
      toast.success('تمت إضافة الموظف');
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'فشل حفظ الموظف');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>موظف جديد</CardTitle>
          <button onClick={onClose}>
            <X className="h-4 w-4 text-zinc-400" />
          </button>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <Input
            label="الاسم الكامل *"
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            required
          />
          <div className="grid md:grid-cols-2 gap-4">
            <Input
              label="رقم الهوية"
              value={form.nationalId}
              onChange={(e) => setForm({ ...form, nationalId: e.target.value })}
            />
            <Input
              label="الهاتف"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <Input
              label="القسم"
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
            />
            <Input
              label="المنصب"
              value={form.position}
              onChange={(e) => setForm({ ...form, position: e.target.value })}
            />
          </div>
          <Input
            label="الراتب الأساسي (د.أ)"
            type="number"
            value={form.baseSalary}
            onChange={(e) => setForm({ ...form, baseSalary: e.target.value })}
          />
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={onClose}>
              إلغاء
            </Button>
            <Button type="submit" loading={saving}>
              حفظ
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function EditEmployeeForm({
  employee,
  onClose,
  onSaved,
  onError,
}: {
  employee: any;
  onClose: () => void;
  onSaved: () => void;
  onError?: (m: string) => void;
}) {
  const [form, setForm] = useState({
    fullName: employee.fullName ?? '',
    phone: employee.phone ?? '',
    department: employee.department ?? '',
    position: employee.position ?? '',
    baseSalary: employee.baseSalary != null ? String(employee.baseSalary) : '',
    notes: employee.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.patch(`/employees/${employee.id}`, {
        fullName: form.fullName,
        phone: form.phone || undefined,
        department: form.department || undefined,
        position: form.position || undefined,
        baseSalary: form.baseSalary !== '' ? +form.baseSalary : undefined,
        notes: form.notes || undefined,
      });
      onSaved();
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'فشل حفظ التعديلات — حاول مرة أخرى';
      setError(msg);
      onError?.(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>تعديل بيانات الموظف — {employee.fullName}</CardTitle>
          <button onClick={onClose}>
            <X className="h-4 w-4 text-zinc-400" />
          </button>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <Input
            label="الاسم الكامل *"
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            required
          />
          <div className="grid md:grid-cols-2 gap-4">
            <Input
              label="القسم"
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
            />
            <Input
              label="المنصب"
              value={form.position}
              onChange={(e) => setForm({ ...form, position: e.target.value })}
            />
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <Input
              label="الهاتف"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            <Input
              label="الراتب الأساسي (د.أ)"
              type="number"
              value={form.baseSalary}
              onChange={(e) => setForm({ ...form, baseSalary: e.target.value })}
            />
          </div>
          <Input
            label="ملاحظات"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={onClose}>
              إلغاء
            </Button>
            <Button type="submit" loading={saving}>
              حفظ التعديلات
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── إدارة العمل الإضافي (OverTime) ──────────────────────────────
function OvertimeModal({
  employee,
  onClose,
  onChanged,
}: {
  employee: any;
  onClose: () => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [hours, setHours] = useState('');
  const [notes, setNotes] = useState('');

  const key = ['overtime', employee.id, month];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api.get(`/employees/${employee.id}/overtime?month=${month}`).then((r) => r.data),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['overtime', employee.id] });
    onChanged();
  };

  const add = useMutation({
    mutationFn: (body: { date: string; hours: number; notes?: string }) =>
      api.post(`/employees/${employee.id}/overtime`, body).then((r) => r.data),
    onSuccess: () => {
      toast.success('تم تسجيل ساعات العمل الإضافي');
      setHours('');
      setNotes('');
      refresh();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'تعذّر حفظ الساعات'),
  });

  const update = useMutation({
    mutationFn: ({ id, hours }: { id: string; hours: number }) =>
      api.patch(`/employees/overtime/${id}`, { hours }).then((r) => r.data),
    onSuccess: () => {
      toast.success('تم تعديل الساعات');
      refresh();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'تعذّر التعديل'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/employees/overtime/${id}`).then((r) => r.data),
    onSuccess: () => {
      toast.success('تم حذف العمل الإضافي');
      refresh();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'تعذّر الحذف'),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const h = parseFloat(hours);
    if (isNaN(h) || h <= 0) return toast.error('عدد ساعات غير صحيح');
    add.mutate({ date, hours: h, notes: notes || undefined });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-zinc-100 sticky top-0 bg-white">
          <div>
            <h3 className="font-bold">العمل الإضافي — {employee.fullName}</h3>
            <p className="text-xs text-zinc-500 mt-0.5">سجّل/عدّل/احذف ساعات الـ OverTime</p>
          </div>
          <button onClick={onClose}>
            <X className="h-5 w-5 text-zinc-400" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* اختيار الشهر + الإجماليات */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="h-9 px-2 rounded-lg border border-zinc-200 text-sm"
            />
            <div className="flex gap-2 text-xs">
              <span className="rounded-lg bg-zinc-50 border border-zinc-100 px-2.5 py-1.5">
                سعر الساعة الإضافية: <b data-numeric>{formatNumber(data?.overtimeHourlyRate ?? 0, 2)}</b> د.أ
              </span>
              <span className="rounded-lg bg-blue-50 border border-blue-100 px-2.5 py-1.5 text-blue-700">
                إجمالي: <b data-numeric>{formatNumber(data?.totalHours ?? 0, 1)}</b> س = <b data-numeric>{formatNumber(data?.totalValue ?? 0, 2)}</b> د.أ
              </span>
            </div>
          </div>

          {/* نموذج إضافة */}
          <form onSubmit={submit} className="grid grid-cols-2 gap-3 rounded-xl bg-zinc-50 border border-zinc-100 p-3">
            <div>
              <label className="text-xs font-bold text-zinc-700 block mb-1">التاريخ</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
              />
            </div>
            <Input label="عدد الساعات" type="number" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="مثال: 3" />
            <div className="col-span-2">
              <Input label="ملاحظات (اختياري)" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="col-span-2 flex justify-end">
              <Button type="submit" size="sm" loading={add.isPending}>
                <Plus className="h-4 w-4" /> إضافة ساعات
              </Button>
            </div>
          </form>

          {/* قائمة السجلات */}
          {isLoading ? (
            <p className="text-sm text-zinc-500 text-center py-4">جاري التحميل...</p>
          ) : !data?.entries || data.entries.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-6">لا يوجد عمل إضافي مُسجَّل لهذا الشهر</p>
          ) : (
            <div className="space-y-2">
              {data.entries.map((en: any) => (
                <OvertimeRow
                  key={en.id}
                  entry={en}
                  onUpdate={(h) => update.mutate({ id: en.id, hours: h })}
                  onDelete={() => {
                    if (!confirm('حذف ساعات العمل الإضافي لهذا اليوم؟')) return;
                    remove.mutate(en.id);
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

function OvertimeRow({
  entry,
  onUpdate,
  onDelete,
  busy,
}: {
  entry: any;
  onUpdate: (hours: number) => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(entry.hours));

  const d = new Date(entry.date);
  const dateLabel = isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ar-JO', { day: 'numeric', month: 'short' });

  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-100 p-2.5">
      <div className="w-16 text-xs text-zinc-500">{dateLabel}</div>
      {editing ? (
        <input
          type="number"
          step="0.5"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          className="w-20 h-8 px-2 rounded border border-zinc-200 text-sm"
          autoFocus
        />
      ) : (
        <div className="flex-1 text-sm">
          <b data-numeric>{entry.hours}</b> ساعة
          <span className="text-zinc-400 mr-2">= {formatNumber(entry.value, 2)} د.أ</span>
          {entry.notes && <span className="text-[11px] text-zinc-500 block">📝 {entry.notes}</span>}
        </div>
      )}
      <div className="flex gap-1.5 mr-auto">
        {editing ? (
          <>
            <Button
              size="sm"
              onClick={() => {
                const h = parseFloat(val);
                if (isNaN(h) || h < 0) return;
                onUpdate(h);
                setEditing(false);
              }}
              loading={busy}
            >
              حفظ
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              إلغاء
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              <Pencil className="h-3 w-3" />
            </Button>
            <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={onDelete}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── دفعة/مكافأة إضافية (مبلغ + سبب) ───────────────────────────
function ExtraPaymentModal({
  employee,
  onClose,
  onSaved,
}: {
  employee: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [month, setMonth] = useState(currentMonth);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return; // منع النقر المتعدد
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return toast.error('مبلغ غير صحيح');
    if (!reason.trim()) return toast.error('السبب مطلوب');

    setSaving(true);
    try {
      // اقرأ التعديل الحالي إن وُجد ثم أضف المكافأة الجديدة إلى bonus
      const payroll = await api.get(`/employees/payroll?month=${month}`).then((r) => r.data);
      const row = payroll?.rows?.find((r: any) => r.employeeId === employee.id);
      const currentBonus = row?.bonus ?? 0;
      const currentNotes = row?.notes ?? '';
      const newBonus = Number(currentBonus) + amt;
      const newNotes = currentNotes
        ? `${currentNotes}\n${new Date().toLocaleDateString('ar-JO')} · ${amt} د.أ · ${reason}`
        : `${new Date().toLocaleDateString('ar-JO')} · ${amt} د.أ · ${reason}`;

      await api.post('/employees/payroll/adjustment', {
        employeeId: employee.id,
        month,
        bonus: newBonus,
        notes: newNotes,
      });
      onSaved();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'تعذّر الحفظ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-zinc-100">
          <div>
            <h3 className="font-bold">دفعة إضافية — {employee.fullName}</h3>
            <p className="text-xs text-zinc-500 mt-0.5">مثلاً: عمل نهاية الأسبوع، مكافأة أداء، بدل...</p>
          </div>
          <button onClick={onClose}>
            <X className="h-5 w-5 text-zinc-400" />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <Input
            label="المبلغ (د.أ) *"
            type="number" step="0.01" value={amount}
            onChange={(e) => setAmount(e.target.value)} required
            placeholder="مثال: 250"
          />
          <Input
            label="السبب / الملاحظة *"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="مثال: عمل نهاية الأسبوع"
            required
          />
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-zinc-700">شهر الاحتساب</label>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
            />
          </div>
          <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-3 text-xs text-emerald-800">
            سيُضاف المبلغ إلى مكافأة الشهر ويظهر في كشف الرواتب فوراً. يمكنك مراجعته من صفحة الرواتب.
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={onClose}>إلغاء</Button>
            <Button type="submit" loading={saving} disabled={saving}>حفظ</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
