'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Banknote, Printer, Pencil, Wallet, CheckCircle2, X } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, CardHeader, CardTitle, CardContent, Button, Input } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/api';
import { formatNumber } from '@/lib/utils';

export default function PayrollPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [editing, setEditing] = useState<any>(null);
  const [payCashbox, setPayCashbox] = useState('');

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['payroll', month],
    queryFn: () => api.get(`/employees/payroll?month=${month}`).then((r) => r.data),
  });

  const { data: cashboxes } = useQuery({
    queryKey: ['cashboxes'],
    queryFn: () => api.get('/finance/cashboxes').then((r) => r.data),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['payroll'] });
    qc.invalidateQueries({ queryKey: ['cashboxes'] });
    qc.invalidateQueries({ queryKey: ['finance'] });
    qc.invalidateQueries({ queryKey: ['cash-movements'] });
  };

  const pay = useMutation({
    mutationFn: (body: { month: string; employeeId?: string; cashboxId?: string }) =>
      api.post('/employees/payroll/pay', body).then((r) => r.data),
    onSuccess: (res) => {
      toast.success(res?.message || 'تم صرف الرواتب وخصمها من الصندوق');
      refresh();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'تعذّر صرف الراتب'),
  });

  const totals = data?.totals;

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6 print:p-0">
        <header className="flex items-center justify-between flex-wrap gap-3 print:hidden">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-zinc-900 text-white flex items-center justify-center">
              <Banknote className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-black tracking-tight">كشف الرواتب</h1>
              <p className="text-sm text-zinc-500 mt-0.5">حساب تلقائي + مكافآت وخصومات وصرف من الصندوق</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="h-10 px-3 rounded-lg border border-zinc-200 text-sm"
            />
            <Button variant="outline" onClick={() => window.print()} disabled={!data}>
              <Printer className="h-4 w-4" /> طباعة
            </Button>
          </div>
        </header>

        {/* رأس الطباعة */}
        <div className="hidden print:block mb-4">
          <div className="text-lg font-black">مصنع قصراوي إخوان — كشف رواتب شهر {month}</div>
        </div>

        {/* الإجماليات */}
        {totals && (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="rounded-xl bg-zinc-50 border border-zinc-100 p-3">
              <div className="text-[10px] font-bold text-zinc-500 uppercase">الرواتب الأساسية</div>
              <div className="text-lg font-black mt-1" data-numeric>{formatNumber(totals.baseSalary, 0)}</div>
            </div>
            <div className="rounded-xl bg-red-50 border border-red-100 p-3">
              <div className="text-[10px] font-bold text-red-700 uppercase">الخصومات</div>
              <div className="text-lg font-black mt-1 text-red-700" data-numeric>{formatNumber(totals.deductions, 0)}</div>
            </div>
            <div className="rounded-xl bg-blue-50 border border-blue-100 p-3">
              <div className="text-[10px] font-bold text-blue-700 uppercase">مكافآت + إضافي</div>
              <div className="text-lg font-black mt-1 text-blue-700" data-numeric>{formatNumber((totals.bonus ?? 0) + (totals.overtimePay ?? 0), 0)}</div>
            </div>
            <div className="rounded-xl bg-amber-50 border border-amber-100 p-3">
              <div className="text-[10px] font-bold text-amber-700 uppercase">غير مدفوع</div>
              <div className="text-lg font-black mt-1 text-amber-700" data-numeric>{formatNumber(totals.unpaid ?? 0, 0)}</div>
            </div>
            <div className="rounded-xl bg-emerald-600 text-white p-3">
              <div className="text-[10px] font-bold uppercase opacity-90">صافي المستحق</div>
              <div className="text-lg font-black mt-1" data-numeric>{formatNumber(totals.net, 0)} د.أ</div>
            </div>
          </div>
        )}

        {/* صرف جماعي */}
        {totals && (totals.unpaid ?? 0) > 0 && (
          <div className="flex items-center gap-2 flex-wrap rounded-xl border border-zinc-200 bg-white p-3 print:hidden">
            <Wallet className="h-4 w-4 text-zinc-500" />
            <span className="text-sm text-zinc-600">صرف من الصندوق:</span>
            <select
              value={payCashbox}
              onChange={(e) => setPayCashbox(e.target.value)}
              className="h-9 px-2 rounded-lg border border-zinc-200 text-sm"
            >
              <option value="">الصندوق الرئيسي (افتراضي)</option>
              {cashboxes?.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {formatNumber(c.balance, 0)} د.أ
                </option>
              ))}
            </select>
            <Button
              onClick={() => {
                if (!confirm(`صرف جميع الرواتب غير المدفوعة لشهر ${month}؟ سيتم خصمها من الصندوق.`)) return;
                pay.mutate({ month, cashboxId: payCashbox || undefined });
              }}
              loading={pay.isPending && !pay.variables?.employeeId}
            >
              <Wallet className="h-4 w-4" /> صرف كل الرواتب المستحقة
            </Button>
          </div>
        )}

        <Card>
          {isLoading ? (
            <div className="p-8 text-center text-zinc-500">جاري الحساب...</div>
          ) : error ? (
            <div className="p-8 text-center text-amber-600 text-sm">لا تملك صلاحية عرض الرواتب (للمدراء/المحاسب/الموارد البشرية).</div>
          ) : !data?.rows || data.rows.length === 0 ? (
            <div className="p-12 text-center text-zinc-500">لا يوجد موظفون لهذا الشهر</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 border-b border-zinc-200">
                  <tr>
                    <th className="text-right p-2.5 text-[10px] font-bold text-zinc-500 uppercase">الموظف</th>
                    <th className="text-right p-2.5 text-[10px] font-bold text-zinc-500 uppercase">الأساسي</th>
                    <th className="text-right p-2.5 text-[10px] font-bold text-zinc-500 uppercase">حضور</th>
                    <th className="text-right p-2.5 text-[10px] font-bold text-zinc-500 uppercase">غياب</th>
                    <th className="text-right p-2.5 text-[10px] font-bold text-zinc-500 uppercase">تأخير(س)</th>
                    <th className="text-right p-2.5 text-[10px] font-bold text-zinc-500 uppercase">إضافي(س)</th>
                    <th className="text-right p-2.5 text-[10px] font-bold text-zinc-500 uppercase">خصومات</th>
                    <th className="text-right p-2.5 text-[10px] font-bold text-zinc-500 uppercase">مكافأة</th>
                    <th className="text-right p-2.5 text-[10px] font-bold text-zinc-500 uppercase">أجر إضافي</th>
                    <th className="text-right p-2.5 text-[10px] font-bold text-zinc-500 uppercase">الصافي</th>
                    <th className="text-right p-2.5 text-[10px] font-bold text-zinc-500 uppercase print:hidden">إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r: any) => (
                    <tr key={r.employeeId} className="border-b border-zinc-100 hover:bg-zinc-50">
                      <td className="p-2.5">
                        <div className="font-medium flex items-center gap-1.5">
                          {r.fullName}
                          {r.paid && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
                              <CheckCircle2 className="h-3 w-3" /> مدفوع
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-zinc-400">{r.department || '—'}</div>
                        {r.notes && <div className="text-[11px] text-zinc-500 mt-0.5">📝 {r.notes}</div>}
                      </td>
                      <td className="p-2.5" data-numeric>{formatNumber(r.baseSalary, 0)}</td>
                      <td className="p-2.5" data-numeric>{r.presentDays}</td>
                      <td className="p-2.5" data-numeric>{r.absentDays > 0 ? <span className="text-red-600 font-bold">{r.absentDays}</span> : 0}</td>
                      <td className="p-2.5" data-numeric>{r.lateHours}</td>
                      <td className="p-2.5" data-numeric>{r.overtimeHours}</td>
                      <td className="p-2.5 text-red-600" data-numeric>{formatNumber(r.absenceDeduction + r.lateDeduction + r.manualDeduction, 0)}</td>
                      <td className="p-2.5 text-blue-600" data-numeric>{r.bonus > 0 ? formatNumber(r.bonus, 0) : '—'}</td>
                      <td className="p-2.5 text-blue-600" data-numeric>{formatNumber(r.overtimePay, 0)}</td>
                      <td className="p-2.5 font-black text-emerald-700" data-numeric>
                        {formatNumber(r.net, 0)}
                        {r.overrideNet != null && <span className="text-[10px] text-amber-600 mr-1">(يدوي)</span>}
                      </td>
                      <td className="p-2.5 print:hidden">
                        <div className="flex gap-1.5">
                          <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                            <Pencil className="h-3 w-3" /> تعديل
                          </Button>
                          {!r.paid && r.net > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                              onClick={() => {
                                if (!confirm(`صرف راتب ${r.fullName} (${formatNumber(r.net, 0)} د.أ)؟`)) return;
                                pay.mutate({ month, employeeId: r.employeeId, cashboxId: payCashbox || undefined });
                              }}
                              loading={pay.isPending && pay.variables?.employeeId === r.employeeId}
                            >
                              <Wallet className="h-3 w-3" /> صرف
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <p className="text-[11px] text-zinc-400 print:hidden">
          الحساب: اليومية = الراتب ÷ {data?.workingDays ?? 26} يوم · الساعة = اليومية ÷ 8 · الإضافي بمعدل 1.5×. علّم الغياب/التأخير/الإضافي من صفحة الموظفين، وأضف المكافآت/الخصومات اليدوية من زر «تعديل».
        </p>
      </div>

      {editing && (
        <PayrollEditModal
          row={editing}
          month={month}
          onClose={() => setEditing(null)}
          onSaved={() => {
            toast.success('تم حفظ تعديل الراتب');
            setEditing(null);
            qc.invalidateQueries({ queryKey: ['payroll'] });
          }}
          onError={(m) => toast.error(m)}
        />
      )}
    </AppShell>
  );
}

function PayrollEditModal({
  row,
  month,
  onClose,
  onSaved,
  onError,
}: {
  row: any;
  month: string;
  onClose: () => void;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const [bonus, setBonus] = useState(String(row.bonus || ''));
  const [deduction, setDeduction] = useState(String(row.manualDeduction || ''));
  const [overrideNet, setOverrideNet] = useState(row.overrideNet != null ? String(row.overrideNet) : '');
  const [notes, setNotes] = useState(row.notes || '');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/employees/payroll/adjustment', {
        employeeId: row.employeeId,
        month,
        bonus: bonus === '' ? 0 : +bonus,
        deduction: deduction === '' ? 0 : +deduction,
        overrideNet: overrideNet === '' ? null : +overrideNet,
        notes: notes || null,
      });
      onSaved();
    } catch (err: any) {
      onError(err?.response?.data?.message || 'تعذّر حفظ التعديل');
    } finally {
      setSaving(false);
    }
  };

  // معاينة الصافي
  const previewNet =
    overrideNet !== ''
      ? +overrideNet
      : row.computedNet + (bonus === '' ? 0 : +bonus) - (deduction === '' ? 0 : +deduction);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-zinc-100">
          <div>
            <h3 className="font-bold">تعديل راتب — {row.fullName}</h3>
            <p className="text-xs text-zinc-500 mt-0.5">شهر {month}</p>
          </div>
          <button onClick={onClose}>
            <X className="h-5 w-5 text-zinc-400" />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div className="rounded-lg bg-zinc-50 border border-zinc-100 p-3 text-xs text-zinc-600 space-y-1">
            <div className="flex justify-between"><span>الأساسي</span><span data-numeric>{formatNumber(row.baseSalary, 0)} د.أ</span></div>
            <div className="flex justify-between"><span>خصم غياب/تأخير</span><span className="text-red-600" data-numeric>{formatNumber(row.absenceDeduction + row.lateDeduction, 1)}</span></div>
            <div className="flex justify-between"><span>أجر إضافي</span><span className="text-blue-600" data-numeric>{formatNumber(row.overtimePay, 1)}</span></div>
            <div className="flex justify-between font-bold border-t border-zinc-200 pt-1"><span>الصافي التلقائي</span><span data-numeric>{formatNumber(row.computedNet, 1)} د.أ</span></div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input label="مكافأة (د.أ)" type="number" step="0.01" value={bonus} onChange={(e) => setBonus(e.target.value)} placeholder="0" />
            <Input label="خصم يدوي (د.أ)" type="number" step="0.01" value={deduction} onChange={(e) => setDeduction(e.target.value)} placeholder="0" />
          </div>
          <Input
            label="تجاوز الصافي يدوياً (اختياري)"
            type="number"
            step="0.01"
            value={overrideNet}
            onChange={(e) => setOverrideNet(e.target.value)}
            placeholder="اتركه فارغاً للحساب التلقائي"
            hint="إن أدخلت قيمة هنا، يصبح الصافي = هذه القيمة بالضبط"
          />
          <Input label="ملاحظات" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظة على راتب الشهر" />

          <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 flex justify-between items-center">
            <span className="text-sm font-bold text-emerald-800">الصافي بعد التعديل</span>
            <span className="text-lg font-black text-emerald-700" data-numeric>{formatNumber(previewNet, 1)} د.أ</span>
          </div>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={onClose}>إلغاء</Button>
            <Button type="submit" loading={saving}>حفظ التعديل</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
