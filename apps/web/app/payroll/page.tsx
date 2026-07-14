'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Banknote, Printer, FileSpreadsheet, Save, RefreshCw, CheckCircle2,
  Filter, X, Pencil, Wallet,
} from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Button, Badge } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/api';
import { FACTORY_NAME } from '@/lib/branding';

/**
 * الصفحة الرئيسية للرواتب (Payroll) — واجهة محاسبية تفاعلية.
 *
 * دمجت مع تصميم "كشف الرواتب الرسمي":
 *  - عرض + تحرير + حفظ + إعادة حساب + طباعة + Excel كلها في نفس الصفحة.
 *  - الحقول القابلة للتحرير: الراتب الأساسي، بدل مواصلات، عمل إضافي،
 *    سلف الموظفين، خصم الدوام.
 *  - الحقول المحسوبة تلقائياً (إجمالي، ضمان، صافي) تُعرض live أثناء التحرير،
 *    والـ backend يُصحّحها بعد الحفظ (المصدر الرسمي للأرقام).
 *  - زر طباعة يفتح /payroll/sheet للطباعة الرسمية (نفس الأرقام).
 *  - زر Excel يصدّر CSV بنفس التنسيق.
 */
export default function PayrollPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [department, setDepartment] = useState('');
  const [employee, setEmployee] = useState('');
  const [paidFilter, setPaidFilter] = useState<'ALL' | 'PAID' | 'UNPAID'>('ALL');
  const [dirty, setDirty] = useState<Record<string, any>>({});
  const [editingRow, setEditingRow] = useState<any>(null);

  const { data, refetch, isFetching } = useQuery({
    queryKey: ['payroll', month],
    queryFn: () => api.get(`/employees/payroll?month=${month}`).then((r) => r.data),
  });

  const rows = useMemo(() => {
    const list = (data?.rows ?? []) as any[];
    return list.filter((r) => {
      if (department && (r.department || '') !== department) return false;
      if (employee && !((r.fullName || '') as string).includes(employee)) return false;
      if (paidFilter === 'PAID' && !r.paid) return false;
      if (paidFilter === 'UNPAID' && r.paid) return false;
      return true;
    });
  }, [data, department, employee, paidFilter]);

  const departments = useMemo(() => {
    const set = new Set<string>();
    (data?.rows ?? []).forEach((r: any) => r.department && set.add(r.department));
    return Array.from(set).sort();
  }, [data]);

  // ─── القيم الفعلية (بعد تطبيق التعديلات الظاهرة على الشاشة) ─
  const effective = (r: any) => {
    const d = dirty[r.employeeId] ?? {};
    const base = d.baseSalary != null ? Number(d.baseSalary) : Number(r.baseSalary || 0);
    const transport = d.transportOverride != null ? Number(d.transportOverride) : Number(r.transportAllowance || 0);
    const overtime = d.overtimeAmount != null ? Number(d.overtimeAmount) : Number(r.overtimeAmount || 0);
    const advance = d.advanceDeduction != null ? Number(d.advanceDeduction) : Number(r.advanceDeduction || 0);
    const attendance = d.attendanceOverride != null ? Number(d.attendanceOverride) : Number(r.attendanceDeduction || 0);
    // إعادة حساب الضمان بنفس قاعدة الـ backend
    const empSSRate = Number(data?.settings?.employeeSSRate ?? 0.075);
    const compSSRate = Number(data?.settings?.companySSRate ?? 0.1425);
    const basis = data?.settings?.socialSecurityBasis ?? 'BASIC';
    const gross = base + overtime + transport;
    const ssBase = basis === 'GROSS' ? gross : basis === 'BASIC_PLUS_TRANSPORT' ? base + transport : base;
    const empSS = ssBase * empSSRate;
    const compSS = ssBase * compSSRate;
    const totalDed = empSS + advance + attendance;
    const net = gross - totalDed;
    return { base, transport, overtime, advance, attendance, gross, empSS, compSS, totalDed, net };
  };

  // ─── إجماليات تُحسب من القيم الفعلية للصفوف المُصفَّاة ─
  const totals = useMemo(() => {
    let baseSalary = 0, transport = 0, overtime = 0, gross = 0;
    let empSS = 0, compSS = 0, advance = 0, attendance = 0, netDed = 0, net = 0;
    rows.forEach((r: any) => {
      const e = effective(r);
      baseSalary += e.base; transport += e.transport; overtime += e.overtime;
      gross += e.gross; empSS += e.empSS; compSS += e.compSS;
      advance += e.advance; attendance += e.attendance;
      netDed += e.totalDed; net += e.net;
    });
    return {
      baseSalary, transport, overtime, gross,
      empSS, compSS, advance, attendance, netDed, net,
      totalCompanyCost: gross + compSS,
      count: rows.length,
    };
  }, [rows, dirty, data]);

  const setF = (empId: string, field: string, value: any) => {
    setDirty((d) => ({ ...d, [empId]: { ...d[empId], [field]: value } }));
  };

  const saveRow = useMutation({
    mutationFn: async (row: any) => {
      const d = dirty[row.employeeId] ?? {};
      const patch: any = { employeeId: row.employeeId, month };
      // baseSalary — نُخزنه على الموظف مباشرة (تعديل دائم)
      if (d.baseSalary != null && Number(d.baseSalary) !== Number(row.baseSalary || 0)) {
        await api.patch(`/employees/${row.employeeId}`, { baseSalary: Number(d.baseSalary) });
      }
      if (d.transportOverride != null) patch.transportOverride = Number(d.transportOverride);
      if (d.overtimeAmount != null) patch.overtimeAmount = Number(d.overtimeAmount);
      if (d.attendanceOverride != null) patch.deduction = Number(d.attendanceOverride);
      if (d.notes != null) patch.notes = d.notes;
      if (d.overrideReason != null) patch.overrideReason = d.overrideReason;
      return api.post('/employees/payroll/adjustment', patch).then((r) => r.data);
    },
    onSuccess: (_, row) => {
      toast.success(`تم حفظ راتب ${row.fullName}`);
      setDirty((d) => { const c = { ...d }; delete c[row.employeeId]; return c; });
      refetch();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'تعذّر الحفظ'),
  });

  const saveAll = useMutation({
    mutationFn: async () => {
      // 1) خزن أي baseSalary تغيّر على مستوى الموظف
      for (const empId of Object.keys(dirty)) {
        const d = dirty[empId];
        const row = (data?.rows ?? []).find((r: any) => r.employeeId === empId);
        if (row && d.baseSalary != null && Number(d.baseSalary) !== Number(row.baseSalary || 0)) {
          await api.patch(`/employees/${empId}`, { baseSalary: Number(d.baseSalary) });
        }
      }
      // 2) bulk-save التعديلات الشهرية
      const payload = {
        month,
        rows: Object.entries(dirty).map(([employeeId, d]: any) => ({
          employeeId,
          transportOverride: d.transportOverride != null ? Number(d.transportOverride) : undefined,
          overtimeAmount: d.overtimeAmount != null ? Number(d.overtimeAmount) : undefined,
          deduction: d.attendanceOverride != null ? Number(d.attendanceOverride) : undefined,
          notes: d.notes,
          overrideReason: d.overrideReason,
        })),
      };
      return api.post('/employees/payroll/save-all', payload).then((r) => r.data);
    },
    onSuccess: (res) => {
      toast.success(`تم حفظ ${res?.saved ?? 0} صف${res?.failed ? ` (فشل ${res.failed})` : ''}`);
      setDirty({});
      refetch();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'تعذّر الحفظ'),
  });

  const dirtyCount = Object.keys(dirty).length;

  // ─── Excel export (نفس المخرَج المستخدم في /payroll/sheet) ─
  const exportExcel = () => {
    const BOM = '﻿';
    const headers = [
      'الرقم', 'اسم الموظف', 'الراتب الأساسي', 'بدل مواصلات', 'عمل إضافي',
      'إجمالي الراتب', 'ضمان الشركة 14.25%', 'ضمان الموظف 7.5%',
      'سلف الموظفين', 'خصم الدوام', 'صافي الاقتطاعات', 'صافي الراتب',
    ];
    const csvRows: any[][] = [headers];
    rows.forEach((r: any, i: number) => {
      const e = effective(r);
      csvRows.push([
        i + 1, r.fullName,
        e.base.toFixed(3), e.transport.toFixed(3), e.overtime.toFixed(3),
        e.gross.toFixed(3), e.compSS.toFixed(3), e.empSS.toFixed(3),
        e.advance.toFixed(3), e.attendance.toFixed(3),
        e.totalDed.toFixed(3), e.net.toFixed(3),
      ]);
    });
    csvRows.push([
      'الإجماليات', '',
      totals.baseSalary.toFixed(3), totals.transport.toFixed(3), totals.overtime.toFixed(3),
      totals.gross.toFixed(3), totals.compSS.toFixed(3), totals.empSS.toFixed(3),
      totals.advance.toFixed(3), totals.attendance.toFixed(3),
      totals.netDed.toFixed(3), totals.net.toFixed(3),
    ]);
    csvRows.push([]);
    csvRows.push(['إجمالي تكلفة الرواتب على الشركة', totals.totalCompanyCost.toFixed(3)]);
    const csv = BOM + csvRows.map((r) => r.map((v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `payroll-${month}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <AppShell>
      <div className="max-w-[297mm] mx-auto p-4 md:p-6 space-y-4 print:p-0">
        {/* شريط الأدوات — يختفي عند الطباعة */}
        <header className="flex items-center justify-between flex-wrap gap-3 print:hidden">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-zinc-900 text-white flex items-center justify-center">
              <Banknote className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-black tracking-tight">كشف الرواتب</h1>
              <p className="text-sm text-zinc-500 mt-0.5">
                تحرير مباشر · حفظ · طباعة · Excel — كل شيء في نفس الصفحة
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="h-10 px-3 rounded-lg border border-zinc-200 text-sm"
            />
            <Button variant="outline" onClick={() => refetch()} loading={isFetching}>
              <RefreshCw className="h-4 w-4" /> إعادة حساب
            </Button>
            <Button variant="outline" onClick={exportExcel}>
              <FileSpreadsheet className="h-4 w-4" /> Excel
            </Button>
            <Button
              variant="outline"
              onClick={() => window.open(`/payroll/sheet?month=${month}`, '_blank', 'noopener')}
            >
              <Printer className="h-4 w-4" /> طباعة / PDF
            </Button>
            <Button
              onClick={() => saveAll.mutate()}
              disabled={dirtyCount === 0 || saveAll.isPending}
              loading={saveAll.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 border-emerald-600"
            >
              <Save className="h-4 w-4" /> حفظ الكل {dirtyCount > 0 && `(${dirtyCount})`}
            </Button>
          </div>
        </header>

        {/* شريط الفلاتر */}
        <div className="flex gap-2 items-center flex-wrap print:hidden">
          <Filter className="h-4 w-4 text-zinc-400" />
          <select value={department} onChange={(e) => setDepartment(e.target.value)}
            className="h-9 px-2 rounded border border-zinc-200 text-sm">
            <option value="">كل الأقسام</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <input value={employee} onChange={(e) => setEmployee(e.target.value)}
            placeholder="بحث موظف" className="h-9 px-2 rounded border border-zinc-200 text-sm w-40" />
          <select value={paidFilter} onChange={(e) => setPaidFilter(e.target.value as any)}
            className="h-9 px-2 rounded border border-zinc-200 text-sm">
            <option value="ALL">الكل</option>
            <option value="PAID">مصروف</option>
            <option value="UNPAID">غير مصروف</option>
          </select>
          <div className="text-xs text-zinc-500" data-numeric>{rows.length} موظف</div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 print:hidden">
          <Kpi label="عدد الموظفين" value={totals.count} />
          <Kpi label="إجمالي الرواتب" value={fmt(totals.gross)} tint="cyan" />
          <Kpi label="صافي الرواتب" value={fmt(totals.net)} tint="cyan" />
          <Kpi label="تكلفة الشركة الكاملة" value={fmt(totals.totalCompanyCost)} tint="orange" />
        </div>

        {/* الجدول — التفاعلي */}
        <div className="bg-white rounded-xl border border-zinc-200 overflow-x-auto">
          <table className="w-full text-[11px] border-collapse min-w-[1300px]">
            <thead>
              <tr className="bg-amber-300">
                <Th w="30">الرقم</Th>
                <Th>اسم الموظف</Th>
                <ThTint c="blue">الراتب الأساسي</ThTint>
                <ThTint c="green">بدل مواصلات</ThTint>
                <ThTint c="green">عمل إضافي</ThTint>
                <ThTint c="cyan">إجمالي الراتب</ThTint>
                <ThTint c="orange">ضمان الشركة</ThTint>
                <ThTint c="orange">ضمان الموظف</ThTint>
                <ThTint c="orange">سلف الموظفين</ThTint>
                <ThTint c="orange">خصم الدوام</ThTint>
                <ThTint c="orange">صافي الاقتطاعات</ThTint>
                <ThTint c="cyan">صافي الراتب</ThTint>
                <Th>الحالة</Th>
                <Th>إجراء</Th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={14} className="p-8 text-center text-zinc-400 border">لا توجد بيانات لهذا الشهر</td></tr>
              ) : rows.map((r: any, i: number) => {
                const e = effective(r);
                const isDirty = !!dirty[r.employeeId];
                return (
                  <tr key={r.employeeId} className={`border-b border-zinc-200 ${isDirty ? 'bg-amber-50' : 'hover:bg-zinc-50'}`}>
                    <Td>{i + 1}</Td>
                    <Td strong>{r.fullName}</Td>
                    <TdInput c="blue" value={e.base} onChange={(v) => setF(r.employeeId, 'baseSalary', v)} disabled={r.paid} />
                    <TdInput c="green" value={e.transport} onChange={(v) => setF(r.employeeId, 'transportOverride', v)} disabled={r.paid} />
                    <TdInput c="green" value={e.overtime} onChange={(v) => setF(r.employeeId, 'overtimeAmount', v)} disabled={r.paid} />
                    <TdTint c="cyan" strong>{fmt(e.gross)}</TdTint>
                    <TdTint c="orange">{fmt(e.compSS)}</TdTint>
                    <TdTint c="orange">{fmt(e.empSS)}</TdTint>
                    <TdInput c="orange" value={e.advance} onChange={(v) => setF(r.employeeId, 'advanceDeduction', v)} disabled={r.paid} />
                    <TdInput c="orange" value={e.attendance} onChange={(v) => setF(r.employeeId, 'attendanceOverride', v)} disabled={r.paid} />
                    <TdTint c="orange" strong>{fmt(e.totalDed)}</TdTint>
                    <TdTint c="cyan" strong>{fmt(e.net)}</TdTint>
                    <Td>
                      {r.paid ? <Badge variant="success" dot>مصروف</Badge>
                        : isDirty ? <Badge variant="warning" dot>تعديل</Badge>
                        : <Badge variant="default" dot>مسودة</Badge>}
                    </Td>
                    <Td>
                      <div className="flex gap-1">
                        <button
                          onClick={() => saveRow.mutate(r)}
                          disabled={!isDirty || saveRow.isPending || r.paid}
                          className="text-xs px-2 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-bold disabled:opacity-40"
                          title="حفظ هذا السطر"
                        >
                          <Save className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => setEditingRow(r)}
                          className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 font-bold"
                          title="تفاصيل + تعديل موسّع"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-cyan-100 border-t-2 border-zinc-900 font-black">
                <Td colSpan={2} strong>الإجماليات</Td>
                <TdTint c="blue" strong>{fmt(totals.baseSalary)}</TdTint>
                <TdTint c="green" strong>{fmt(totals.transport)}</TdTint>
                <TdTint c="green" strong>{fmt(totals.overtime)}</TdTint>
                <TdTint c="cyan" strong>{fmt(totals.gross)}</TdTint>
                <TdTint c="orange" strong>{fmt(totals.compSS)}</TdTint>
                <TdTint c="orange" strong>{fmt(totals.empSS)}</TdTint>
                <TdTint c="orange" strong>{fmt(totals.advance)}</TdTint>
                <TdTint c="orange" strong>{fmt(totals.attendance)}</TdTint>
                <TdTint c="orange" strong>{fmt(totals.netDed)}</TdTint>
                <TdTint c="cyan" strong>{fmt(totals.net)}</TdTint>
                <Td colSpan={2}></Td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="مجموع الرواتب الأساسية" value={fmt(totals.baseSalary)} tint="blue" />
          <Kpi label="مجموع بدل المواصلات" value={fmt(totals.transport)} tint="green" />
          <Kpi label="مجموع العمل الإضافي" value={fmt(totals.overtime)} tint="green" />
          <Kpi label="مجموع ضمان الموظفين" value={fmt(totals.empSS)} tint="orange" />
          <Kpi label="مجموع ضمان الشركة" value={fmt(totals.compSS)} tint="orange" />
          <Kpi label="مجموع السلف" value={fmt(totals.advance)} tint="orange" />
          <Kpi label="مجموع خصم الدوام" value={fmt(totals.attendance)} tint="orange" />
          <Kpi label="إجمالي تكلفة الرواتب على الشركة" value={fmt(totals.totalCompanyCost)} tint="cyan" />
        </div>
      </div>

      {editingRow && (
        <DetailModal
          row={editingRow}
          effective={effective(editingRow)}
          onChange={(field, value) => setF(editingRow.employeeId, field, value)}
          onSave={() => { saveRow.mutate(editingRow); setEditingRow(null); }}
          onClose={() => setEditingRow(null)}
        />
      )}

      <style jsx global>{`
        table th, table td { border: 1px solid #d4d4d8; padding: 4px 6px; text-align: right; }
        input.pay-cell {
          width: 100%; text-align: right; background: transparent;
          border: 1px dashed transparent; padding: 2px 4px; font-family: inherit;
          font-size: inherit; direction: ltr;
        }
        input.pay-cell:hover { border-color: #d4d4d8; }
        input.pay-cell:focus { border-color: #18181b; background: white; outline: none; }
      `}</style>
    </AppShell>
  );
}

function fmt(v: any) {
  const n = Number(v || 0);
  return n.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function Th({ children, w }: { children: React.ReactNode; w?: string }) {
  return <th style={w ? { width: `${w}px` } : undefined} className="font-black text-[10px] whitespace-nowrap">{children}</th>;
}
function ThTint({ children, c }: { children: React.ReactNode; c: 'blue' | 'green' | 'orange' | 'cyan' }) {
  const bg = { blue: 'bg-sky-200', green: 'bg-emerald-200', orange: 'bg-orange-200', cyan: 'bg-cyan-200' }[c];
  return <th className={`${bg} font-black text-[10px] whitespace-nowrap`}>{children}</th>;
}
function Td({ children, strong, colSpan }: { children?: React.ReactNode; strong?: boolean; colSpan?: number }) {
  return <td colSpan={colSpan} className={`${strong ? 'font-black' : ''} whitespace-nowrap`}>{children}</td>;
}
function TdTint({ children, c, strong }: { children: React.ReactNode; c: 'blue' | 'green' | 'orange' | 'cyan'; strong?: boolean }) {
  const bg = { blue: 'bg-sky-50', green: 'bg-emerald-50', orange: 'bg-orange-50', cyan: 'bg-cyan-50' }[c];
  return <td className={`${bg} ${strong ? 'font-black' : ''} whitespace-nowrap`} data-numeric>{children}</td>;
}
function TdInput({
  value, onChange, disabled, c,
}: { value: number; onChange: (v: string) => void; disabled?: boolean; c: 'blue' | 'green' | 'orange' }) {
  const bg = { blue: 'bg-sky-50', green: 'bg-emerald-50', orange: 'bg-orange-50' }[c];
  return (
    <td className={`${bg} whitespace-nowrap`}>
      <input
        type="number"
        step="0.001"
        min={0}
        defaultValue={value.toFixed(3)}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => { if (Number(e.target.value) < 0) e.target.value = '0'; }}
        disabled={disabled}
        className="pay-cell"
      />
    </td>
  );
}
function Kpi({ label, value, tint }: { label: string; value: any; tint?: 'blue' | 'green' | 'orange' | 'cyan' }) {
  const bg = tint === 'blue' ? 'bg-sky-50' : tint === 'green' ? 'bg-emerald-50' : tint === 'orange' ? 'bg-orange-50' : tint === 'cyan' ? 'bg-cyan-50' : 'bg-zinc-50';
  return (
    <div className={`${bg} rounded p-3 border border-zinc-200`}>
      <div className="text-[10px] text-zinc-500 font-bold">{label}</div>
      <div className="text-base font-black mt-1">{value}</div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   Detail Modal — تعديل موسّع لصف واحد
═══════════════════════════════════════════ */
function DetailModal({
  row, effective, onChange, onSave, onClose,
}: {
  row: any;
  effective: any;
  onChange: (field: string, value: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose} dir="rtl">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white flex items-center justify-between p-5 border-b border-zinc-100 z-10">
          <div>
            <h3 className="font-bold text-lg">تعديل راتب: {row.fullName}</h3>
            <p className="text-xs text-zinc-500">{row.department || '—'} — {row.position || '—'}</p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-900">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="الراتب الأساسي" value={effective.base} onChange={(v) => onChange('baseSalary', v)} />
            <Field label="بدل مواصلات" value={effective.transport} onChange={(v) => onChange('transportOverride', v)} />
            <Field label="عمل إضافي (المبلغ)" value={effective.overtime} onChange={(v) => onChange('overtimeAmount', v)} />
            <Field label="سلف الموظفين (القسط الشهري)" value={effective.advance} onChange={(v) => onChange('advanceDeduction', v)} />
            <Field label="خصم الدوام" value={effective.attendance} onChange={(v) => onChange('attendanceOverride', v)} />
          </div>

          {/* المحسوبة (Read-only) */}
          <div className="grid md:grid-cols-3 gap-3 bg-zinc-50 border border-zinc-100 rounded-lg p-3">
            <RO label="إجمالي الراتب" value={effective.gross} tint="cyan" />
            <RO label="ضمان الموظف 7.5%" value={effective.empSS} tint="orange" />
            <RO label="ضمان الشركة 14.25%" value={effective.compSS} tint="orange" />
            <RO label="صافي الاقتطاعات" value={effective.totalDed} tint="orange" />
            <RO label="صافي الراتب" value={effective.net} tint="cyan" />
            <RO label="تكلفة الشركة" value={effective.gross + effective.compSS} tint="cyan" />
          </div>

          <div>
            <label className="text-xs font-bold text-zinc-700 block mb-1">سبب التعديل (Audit)</label>
            <input value={reason} onChange={(e) => { setReason(e.target.value); onChange('overrideReason', e.target.value); }}
              placeholder="مطلوب عند التعديل اليدوي"
              className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm" />
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={onClose}>إلغاء</Button>
            <Button onClick={onSave}><Save className="h-4 w-4" /> حفظ التعديلات</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: number; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-xs font-bold text-zinc-700 block mb-1">{label}</label>
      <input
        type="number" step="0.001" min={0}
        defaultValue={value.toFixed(3)}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
      />
    </div>
  );
}
function RO({ label, value, tint }: { label: string; value: number; tint?: 'orange' | 'cyan' }) {
  const bg = tint === 'orange' ? 'bg-orange-50' : tint === 'cyan' ? 'bg-cyan-50' : 'bg-zinc-50';
  return (
    <div className={`${bg} rounded p-2 border border-zinc-200`}>
      <div className="text-[10px] text-zinc-500 font-bold">{label}</div>
      <div className="text-sm font-black mt-1" data-numeric>{fmt(value)}</div>
    </div>
  );
}
