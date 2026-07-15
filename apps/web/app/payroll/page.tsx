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
import { computePayrollRow, computePayrollTotals } from '@/lib/payroll-calc';

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

  // ─── القيم الفعلية — من مصدر الحقيقة الواحد lib/payroll-calc.ts ─
  // نفس الحاسبة التي تستخدمها صفحة الكشف الرسمي /payroll/sheet،
  // فتبقى أرقام Desktop و Sheet و PDF و Excel و Mobile متطابقة تماماً.
  const effective = (r: any) => computePayrollRow(r, data?.settings, dirty[r.employeeId]);

  // ─── إجماليات تُحسب من القيم الفعلية للصفوف المُصفَّاة ─
  const totals = useMemo(() => computePayrollTotals(rows.map(effective)), [rows, dirty, data]);

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

  // ─── Excel export (shared enterprise builder — lazy-loaded ExcelJS) ─
  const [xlsBusy, setXlsBusy] = useState(false);
  const exportExcel = async () => {
    if (xlsBusy) return;
    setXlsBusy(true);
    try {
      const mod = await import('@/lib/xlsx-export');
      if (typeof mod.exportXlsx !== 'function') {
        throw new Error('exportXlsx غير متاح — تحقق من تحديث الصفحة');
      }
      await mod.exportXlsx({
      filename: `payroll-${month}.xlsx`,
      reportTitle: 'كشف الرواتب — الواجهة التفاعلية',
      reportTitleEn: 'Payroll (Interactive View)',
      branch: 'المصنع الرئيسي',
      currency: 'JOD',
      rtl: true,
      filters: [
        { label: 'الشهر', value: `${month.slice(5)}/${month.slice(0, 4)}` },
        { label: 'القسم', value: department || 'كل الأقسام' },
        { label: 'الموظف', value: employee || 'كل الموظفين' },
        { label: 'حالة الصرف', value: paidFilter === 'PAID' ? 'مصروف' : paidFilter === 'UNPAID' ? 'غير مصروف' : 'الكل' },
      ],
      kpis: [
        { label: 'عدد الموظفين', value: totals.count, format: 'integer' },
        { label: 'مجموع الرواتب الأساسية', value: totals.baseSalary, format: 'jod', tint: 'blue' },
        { label: 'مجموع بدل المواصلات', value: totals.transport, format: 'jod', tint: 'green' },
        { label: 'مجموع العمل الإضافي', value: totals.overtime, format: 'jod', tint: 'green' },
        { label: 'مجموع إجمالي الرواتب', value: totals.gross, format: 'jod', tint: 'cyan' },
        { label: 'مجموع ضمان الموظفين 7.5%', value: totals.empSS, format: 'jod', tint: 'orange' },
        { label: 'مجموع ضمان الشركة 14.25%', value: totals.compSS, format: 'jod', tint: 'orange' },
        { label: 'مجموع سلف الموظفين', value: totals.advance, format: 'jod', tint: 'orange' },
        { label: 'مجموع خصم الدوام', value: totals.attendance, format: 'jod', tint: 'orange' },
        { label: 'مجموع صافي الاقتطاعات', value: totals.netDed, format: 'jod', tint: 'orange' },
        { label: 'مجموع صافي الرواتب', value: totals.net, format: 'jod', tint: 'cyan' },
        { label: 'إجمالي تكلفة الرواتب على الشركة', value: totals.totalCompanyCost, format: 'jod', tint: 'cyan' },
      ],
      details: {
        sheetName: 'كشف الرواتب · Payroll',
        columns: [
          { key: 'num',       header: 'الرقم', width: 8, align: 'center', format: 'integer' },
          { key: 'name',      header: 'اسم الموظف', width: 28, strong: true },
          { key: 'base',      header: 'الراتب الأساسي', format: 'jod', tint: 'blue' },
          { key: 'transport', header: 'بدل المواصلات', format: 'jod', tint: 'green' },
          { key: 'overtime',  header: 'عمل إضافي', format: 'jod', tint: 'green' },
          { key: 'gross',     header: 'إجمالي الراتب', format: 'jod', tint: 'cyan', strong: true },
          { key: 'compSS',    header: 'ضمان الشركة 14.25%', format: 'jod', tint: 'orange' },
          { key: 'empSS',     header: 'ضمان الموظف 7.5%', format: 'jod', tint: 'orange' },
          { key: 'advance',   header: 'سلف الموظفين', format: 'jod', tint: 'orange' },
          { key: 'attend',    header: 'خصم الدوام', format: 'jod', tint: 'orange' },
          { key: 'totalDed',  header: 'صافي الاقتطاعات', format: 'jod', tint: 'orange', strong: true },
          { key: 'net',       header: 'صافي الراتب', format: 'jod', tint: 'cyan', strong: true },
        ],
        rows: rows.map((r: any, i: number) => {
          const e = effective(r);
          return {
            num: i + 1, name: r.fullName,
            base: e.base, transport: e.transport, overtime: e.overtime,
            gross: e.gross, compSS: e.compSS, empSS: e.empSS,
            advance: e.advance, attend: e.attendance,
            totalDed: e.totalDed, net: e.net,
          };
        }),
        totals: {
          num: null, name: 'الإجماليات · TOTALS',
          base: totals.baseSalary, transport: totals.transport, overtime: totals.overtime,
          gross: totals.gross, compSS: totals.compSS, empSS: totals.empSS,
          advance: totals.advance, attend: totals.attendance,
          totalDed: totals.netDed, net: totals.net,
        },
        conditions: [
          { columnKey: 'attend', when: 'gt', value: 20, bg: 'FFFEE2E2', fg: 'FF991B1B' },
        ],
        footnote: `إجمالي تكلفة الرواتب على الشركة = ${totals.totalCompanyCost.toFixed(3)} د.أ`,
      },
    });
      toast.success('تم تحضير ملف Excel');
    } catch (err: any) {
      // Runtime failures are surfaced instead of silently vanishing —
      // covers cases like Safari <14, blocked download, or ExcelJS chunk load fail.
      console.error('[payroll] Excel export failed:', err);
      toast.error(err?.message || 'تعذّر تصدير Excel — راجع الاتصال');
    } finally {
      setXlsBusy(false);
    }
  };

  return (
    <AppShell>
      {/* DESKTOP (≥ md) — UNCHANGED. Wrapped in hidden md:block. */}
      <div className="hidden md:block max-w-[297mm] mx-auto p-3 md:p-6 space-y-4 pb-24 md:pb-4 print:p-0 print:pb-0">
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
            <Button variant="outline" onClick={exportExcel} disabled={xlsBusy} loading={xlsBusy}>
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

      {/* ═══════════════════════════════════════════════
          MOBILE (< md) — full parity with desktop:
          edit every row (base/transport/overtime/advance/attendance),
          audit reason, save-per-row, save-all, mark paid/unpaid via
          existing endpoints, print PDF, export Excel, filter, search.
          Uses the shared DetailModal (which auto-adapts to viewport).
      ═══════════════════════════════════════════════ */}
      <MobilePayroll
        month={month} onMonth={setMonth}
        rows={rows}
        departments={departments}
        department={department} onDepartment={setDepartment}
        employee={employee} onEmployee={setEmployee}
        paidFilter={paidFilter} onPaidFilter={setPaidFilter}
        totals={totals}
        effective={effective}
        dirtyCount={dirtyCount}
        dirty={dirty}
        onRefresh={() => refetch()}
        isFetching={isFetching}
        onExcel={exportExcel}
        xlsBusy={xlsBusy}
        onOpenEdit={(r: any) => setEditingRow(r)}
        onSaveAll={() => saveAll.mutate()}
        saveAllBusy={saveAll.isPending}
      />

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

/* ═══════════════════════════════════════════════════════════════════
   MOBILE PAYROLL (< md) — full-parity mobile experience.
   Sticky mobile header (title + month picker + primary actions),
   filter sheet, KPI ribbon, employee cards showing live-computed
   numbers, edit button on every card that opens the shared
   DetailModal — same audit reason field, same save flow, same
   backend endpoints as desktop.
═══════════════════════════════════════════════════════════════════ */
function MobilePayroll({
  month, onMonth, rows, departments, department, onDepartment,
  employee, onEmployee, paidFilter, onPaidFilter, totals, effective,
  dirtyCount, dirty, onRefresh, isFetching, onExcel, xlsBusy,
  onOpenEdit, onSaveAll, saveAllBusy,
}: any) {
  const [showFilter, setShowFilter] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const activeFilterCount = (department ? 1 : 0) + (employee ? 1 : 0) + (paidFilter !== 'ALL' ? 1 : 0);

  const openPrint = () =>
    window.open(`/payroll/sheet?month=${month}`, '_blank', 'noopener');

  return (
    <div className="md:hidden print:hidden" dir="rtl">
      {/* Sticky header */}
      <div className="sticky top-0 z-20 bg-zinc-50/95 backdrop-blur border-b border-zinc-200 px-3 pt-3 pb-2">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-zinc-900 text-white flex items-center justify-center shrink-0">
              <Banknote className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-black tracking-tight leading-tight">الرواتب</h1>
              <p className="text-[10px] text-zinc-500">
                {totals.count} موظف{dirtyCount > 0 ? ` · ${dirtyCount} تعديل` : ''}
              </p>
            </div>
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setShowActions(true)}
              aria-label="إجراءات"
              className="w-10 h-10 rounded-full bg-white border border-zinc-200 text-zinc-700 flex items-center justify-center active:scale-95"
            >
              <FileSpreadsheet className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onSaveAll}
              disabled={dirtyCount === 0 || saveAllBusy}
              aria-label="حفظ الكل"
              className="min-w-[44px] h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center px-3 gap-1 font-bold text-xs disabled:opacity-50 shadow-md"
            >
              <Save className="h-4 w-4" />
              {dirtyCount > 0 && <span>{dirtyCount}</span>}
            </button>
          </div>
        </div>

        {/* Month picker + filter */}
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={month}
            onChange={(e) => onMonth(e.target.value)}
            className="flex-1 h-10 px-3 rounded-xl border border-zinc-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
          />
          <button
            type="button"
            onClick={() => setShowFilter(true)}
            aria-label={`فلترة${activeFilterCount ? ` (${activeFilterCount})` : ''}`}
            className={`relative h-10 min-w-[44px] px-3 rounded-xl flex items-center justify-center gap-1.5 text-sm font-bold active:scale-95 ${
              activeFilterCount ? 'bg-zinc-900 text-white' : 'bg-white border border-zinc-200 text-zinc-700'
            }`}
          >
            <Filter className="h-4 w-4" />
            {activeFilterCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-amber-500 text-white text-[10px] font-black flex items-center justify-center px-1">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="px-3 pt-3 pb-24 space-y-3">
        {/* KPI ribbon */}
        <div
          className="flex gap-2 overflow-x-auto -mx-3 px-3 pb-1 [&::-webkit-scrollbar]:hidden"
          style={{ scrollbarWidth: 'none' }}
        >
          <MPKpi label="عدد الموظفين" value={String(totals.count)} />
          <MPKpi label="إجمالي الرواتب" value={fmt(totals.gross)} unit="د.أ" tone="neutral" />
          <MPKpi label="صافي الرواتب"   value={fmt(totals.net)}   unit="د.أ" tone="good" />
          <MPKpi label="ضمان الشركة"    value={fmt(totals.compSS)} unit="د.أ" tone="warn" />
          <MPKpi label="تكلفة الشركة"    value={fmt(totals.totalCompanyCost)} unit="د.أ" tone="neutral" />
        </div>

        {/* Cards — one per employee */}
        {rows.length === 0 ? (
          <div className="bg-white rounded-2xl border border-zinc-200 py-14 text-center">
            <Banknote className="h-10 w-10 mx-auto text-zinc-300 mb-3" />
            <p className="text-sm text-zinc-500">لا توجد بيانات لهذا الشهر</p>
          </div>
        ) : (
          rows.map((r: any) => {
            const e = effective(r);
            const isDirty = !!dirty[r.employeeId];
            return (
              <div
                key={`m-${r.employeeId}`}
                className={`bg-white rounded-2xl border p-3 ${
                  isDirty ? 'border-amber-400 ring-1 ring-amber-200' : 'border-zinc-200'
                }`}
                style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-bold text-zinc-900 leading-tight truncate">{r.fullName}</div>
                    <div className="text-[10px] text-zinc-500 mt-0.5">
                      {r.department || '—'}{r.position ? ` · ${r.position}` : ''}
                    </div>
                  </div>
                  <div className="text-left shrink-0 pl-2">
                    {r.paid ? (
                      <Badge variant="success" dot>مصروف</Badge>
                    ) : isDirty ? (
                      <Badge variant="warning" dot>تعديل</Badge>
                    ) : (
                      <Badge variant="default" dot>مسودة</Badge>
                    )}
                  </div>
                </div>

                {/* Money block — same numbers everywhere (shared calc) */}
                <div className="mt-3 pt-3 border-t border-dashed border-zinc-200 grid grid-cols-3 gap-2">
                  <div>
                    <div className="text-[10px] text-zinc-500">أساسي</div>
                    <div className="text-[13px] font-bold text-zinc-900 mt-0.5" data-numeric>{fmt(e.base)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-zinc-500">إجمالي</div>
                    <div className="text-[13px] font-bold text-cyan-700 mt-0.5" data-numeric>{fmt(e.gross)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-zinc-500">صافي</div>
                    <div className="text-[15px] font-black text-emerald-700 mt-0.5" data-numeric>{fmt(e.net)}</div>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-zinc-600">
                  <span>ضمان موظف: <b>{fmt(e.empSS)}</b></span>
                  <span>ضمان شركة: <b>{fmt(e.compSS)}</b></span>
                  {Number(e.advance) > 0 && <span>سلفة: <b>{fmt(e.advance)}</b></span>}
                  {Number(e.attendance) > 0 && <span>خصم دوام: <b>{fmt(e.attendance)}</b></span>}
                </div>

                <button
                  type="button"
                  onClick={() => onOpenEdit(r)}
                  disabled={r.paid}
                  className="mt-3 w-full min-h-[40px] rounded-xl bg-blue-50 text-blue-800 text-sm font-bold flex items-center justify-center gap-1.5 active:bg-blue-100 disabled:opacity-40"
                >
                  <Pencil className="h-4 w-4" />
                  {r.paid ? 'مصروف — للعرض فقط' : 'تعديل الراتب + سبب التعديل'}
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Actions sheet */}
      {showActions && (
        <MPBottomSheet title="إجراءات الرواتب" onClose={() => setShowActions(false)}>
          <MPSheetRow
            icon={<RefreshCw className="h-4 w-4" />}
            title="إعادة حساب"
            subtitle="سحب أحدث القيم من الخادم"
            onClick={() => { setShowActions(false); onRefresh(); }}
            disabled={isFetching}
          />
          <MPSheetRow
            icon={<FileSpreadsheet className="h-4 w-4" />}
            iconTone="pro"
            title={xlsBusy ? 'جارٍ تحضير Excel…' : 'تصدير Excel'}
            subtitle="ملف .xlsx بنفس أرقام الشاشة"
            onClick={() => { setShowActions(false); onExcel(); }}
            disabled={xlsBusy}
          />
          <MPSheetRow
            icon={<Printer className="h-4 w-4" />}
            iconTone="info"
            title="طباعة / PDF"
            subtitle="كشف رسمي A4 عرضي"
            onClick={() => { setShowActions(false); openPrint(); }}
          />
        </MPBottomSheet>
      )}

      {/* Filter sheet */}
      {showFilter && (
        <MPBottomSheet title="فلترة الرواتب" onClose={() => setShowFilter(false)}>
          <div className="px-4 pt-3">
            <div className="text-[11px] text-zinc-500 font-bold mb-2">القسم</div>
            <div className="grid grid-cols-2 gap-2">
              <MPPill label="كل الأقسام" active={!department} onClick={() => onDepartment('')} />
              {departments.map((d: string) => (
                <MPPill key={d} label={d} active={department === d} onClick={() => onDepartment(d)} />
              ))}
            </div>
          </div>
          <div className="px-4 pt-4">
            <div className="text-[11px] text-zinc-500 font-bold mb-2">حالة الصرف</div>
            <div className="grid grid-cols-3 gap-2">
              <MPPill label="الكل" active={paidFilter === 'ALL'} onClick={() => onPaidFilter('ALL')} />
              <MPPill label="مصروف" active={paidFilter === 'PAID'} onClick={() => onPaidFilter('PAID')} tone="good" />
              <MPPill label="غير مصروف" active={paidFilter === 'UNPAID'} onClick={() => onPaidFilter('UNPAID')} tone="warn" />
            </div>
          </div>
          <div className="px-4 pt-4 pb-3">
            <div className="text-[11px] text-zinc-500 font-bold mb-2">بحث بالاسم</div>
            <input
              value={employee}
              onChange={(e) => onEmployee(e.target.value)}
              placeholder="اكتب جزءاً من الاسم…"
              className="w-full h-11 px-3 rounded-xl border border-zinc-200 text-sm"
            />
          </div>
          <div className="border-t border-zinc-100 p-3 flex gap-2">
            <button
              type="button"
              onClick={() => { onDepartment(''); onEmployee(''); onPaidFilter('ALL'); }}
              className="flex-1 min-h-[44px] rounded-xl bg-zinc-100 text-zinc-800 text-sm font-bold active:bg-zinc-200"
            >
              إعادة
            </button>
            <button
              type="button"
              onClick={() => setShowFilter(false)}
              className="flex-[2] min-h-[44px] rounded-xl bg-zinc-900 text-white text-sm font-bold"
            >
              تطبيق
            </button>
          </div>
        </MPBottomSheet>
      )}
    </div>
  );
}

function MPKpi({ label, value, unit, tone = 'neutral' }: { label: string; value: string; unit?: string; tone?: 'neutral' | 'good' | 'warn' }) {
  const cls = tone === 'good' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : 'text-zinc-900';
  return (
    <div className="flex-shrink-0 bg-white border border-zinc-200 rounded-xl px-3 py-2 min-w-[112px]">
      <div className="text-[10px] text-zinc-500">{label}</div>
      <div className={`font-black text-sm mt-0.5 leading-none ${cls}`} data-numeric>
        {value}{unit && <span className="text-[10px] font-bold text-zinc-400 mr-1">{unit}</span>}
      </div>
    </div>
  );
}

function MPPill({ label, active, onClick, tone }: { label: string; active: boolean; onClick: () => void; tone?: 'good' | 'warn' }) {
  const cls = !active ? 'bg-zinc-100 text-zinc-800'
    : tone === 'good' ? 'bg-emerald-600 text-white'
    : tone === 'warn' ? 'bg-amber-500 text-white'
    : 'bg-zinc-900 text-white';
  return (
    <button type="button" onClick={onClick} className={`min-h-[44px] rounded-xl text-sm font-bold px-2 ${cls}`}>
      {label}
    </button>
  );
}

function MPBottomSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  return (
    <div className="md:hidden fixed inset-0 z-50 flex items-end" role="dialog" aria-modal="true" aria-label={title} dir="rtl">
      <div className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative w-full max-h-[85vh] bg-white rounded-t-2xl flex flex-col shadow-2xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="pt-2 pb-1 flex justify-center"><div className="h-1 w-10 rounded-full bg-zinc-300" /></div>
        <div className="px-4 py-2.5 flex items-center justify-between border-b border-zinc-100">
          <div className="text-sm font-bold">{title}</div>
          <button onClick={onClose} aria-label="إغلاق" className="w-9 h-9 rounded-full hover:bg-zinc-100 active:bg-zinc-200 flex items-center justify-center">
            <X className="h-5 w-5 text-zinc-700" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function MPSheetRow({ icon, title, subtitle, onClick, disabled, iconTone }: any) {
  const toneCls =
    iconTone === 'good' ? 'bg-emerald-50 text-emerald-700' :
    iconTone === 'info' ? 'bg-blue-50 text-blue-700' :
    iconTone === 'pro'  ? 'bg-violet-50 text-violet-700' :
    'bg-zinc-100 text-zinc-700';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center gap-3 px-3 py-3 mx-2 my-0.5 rounded-xl active:bg-zinc-50 min-h-[52px] disabled:opacity-50"
    >
      <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${toneCls}`}>{icon}</span>
      <div className="flex-1 min-w-0 text-right">
        <div className="text-sm font-bold text-zinc-900">{title}</div>
        {subtitle && <div className="text-[10px] text-zinc-500 mt-0.5">{subtitle}</div>}
      </div>
      <span className="text-zinc-300 text-lg">‹</span>
    </button>
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
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center md:justify-center md:p-4"
      onClick={onClose}
      dir="rtl"
    >
      <div
        className="bg-white rounded-t-2xl md:rounded-2xl w-full max-w-2xl h-[95vh] md:h-auto md:max-h-[92vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {/* Grabber (mobile) */}
        <div className="md:hidden pt-2 pb-1 flex justify-center">
          <div className="h-1 w-10 rounded-full bg-zinc-300" />
        </div>

        <div className="flex items-center justify-between px-4 py-3 md:p-5 border-b border-zinc-100 shrink-0">
          <div className="min-w-0">
            <h3 className="font-bold text-base md:text-lg truncate">تعديل راتب: {row.fullName}</h3>
            <p className="text-xs text-zinc-500 truncate">{row.department || '—'} — {row.position || '—'}</p>
          </div>
          <button onClick={onClose} aria-label="إغلاق" className="w-10 h-10 rounded-full flex items-center justify-center text-zinc-500 hover:bg-zinc-100 shrink-0">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 md:p-5 space-y-4">
          {/* One-column on mobile, 2-col on md+ */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="الراتب الأساسي" value={effective.base} onChange={(v) => onChange('baseSalary', v)} />
            <Field label="بدل مواصلات" value={effective.transport} onChange={(v) => onChange('transportOverride', v)} />
            <Field label="عمل إضافي (المبلغ)" value={effective.overtime} onChange={(v) => onChange('overtimeAmount', v)} />
            <Field label="سلف الموظفين (القسط الشهري)" value={effective.advance} onChange={(v) => onChange('advanceDeduction', v)} />
            <Field label="خصم الدوام" value={effective.attendance} onChange={(v) => onChange('attendanceOverride', v)} />
          </div>

          {/* Live-computed (Read-only) — updates instantly as you type */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3 bg-zinc-50 border border-zinc-100 rounded-lg p-3">
            <RO label="إجمالي الراتب" value={effective.gross} tint="cyan" />
            <RO label="ضمان الموظف 7.5%" value={effective.empSS} tint="orange" />
            <RO label="ضمان الشركة 14.25%" value={effective.compSS} tint="orange" />
            <RO label="صافي الاقتطاعات" value={effective.totalDed} tint="orange" />
            <RO label="صافي الراتب" value={effective.net} tint="cyan" />
            <RO label="تكلفة الشركة" value={effective.gross + effective.compSS} tint="cyan" />
          </div>

          <div>
            <label className="text-xs font-bold text-zinc-700 block mb-1">سبب التعديل (Audit)</label>
            <input
              value={reason}
              onChange={(e) => { setReason(e.target.value); onChange('overrideReason', e.target.value); }}
              placeholder="مطلوب عند التعديل اليدوي"
              className="w-full h-11 md:h-10 px-3 rounded-lg border border-zinc-200 text-sm"
            />
          </div>
        </div>

        {/* Sticky footer — always visible even when keyboard is up */}
        <div className="border-t border-zinc-100 p-3 md:p-4 flex gap-2 shrink-0 bg-white">
          <Button variant="ghost" onClick={onClose} className="flex-1 md:flex-initial min-h-[44px]">إلغاء</Button>
          <Button onClick={onSave} className="flex-[2] md:flex-initial min-h-[44px]">
            <Save className="h-4 w-4" /> حفظ التعديلات
          </Button>
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
        // inputMode="decimal" triggers the numeric keyboard on iOS/Android
        // even though the visual keyboard uses a comma or dot per locale.
        type="number" step="0.001" min={0}
        inputMode="decimal"
        pattern="[0-9]*[.,]?[0-9]*"
        defaultValue={value.toFixed(3)}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => { if (Number(e.target.value) < 0) e.target.value = '0'; }}
        className="w-full h-11 md:h-10 px-3 rounded-lg border border-zinc-200 text-sm font-mono"
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
