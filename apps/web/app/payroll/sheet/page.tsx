'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Printer, FileSpreadsheet, Filter } from 'lucide-react';
import { api } from '@/lib/api';
import { FACTORY_NAME } from '@/lib/branding';

/**
 * كشف الرواتب الرسمي (Official Payroll Sheet)
 *
 * تصميم محاسبي احترافي (A4 Landscape) للطباعة و PDF و Excel.
 * لا يعدّل الداشبورد الحالي — صفحة منفصلة تفتح في تبويب جديد.
 * تستخدم نفس الـ endpoint /employees/payroll ولا تكرر أي حسابات.
 *
 * ملاحظة معمارية: Next.js 14 يشترط أن يكون useSearchParams داخل
 * حدود Suspense وقت الـ prerender؛ لذلك نُصدِّر Wrapper يلفّ المكوّن
 * الفعلي بـ <Suspense> لتجنّب فشل الـ build (missing-suspense-with-csr-bailout).
 */
export const dynamic = 'force-dynamic';

export default function PayrollSheetPage() {
  return (
    <Suspense fallback={<div dir="rtl" className="p-8 text-center text-zinc-500">جاري تحميل الكشف...</div>}>
      <PayrollSheetInner />
    </Suspense>
  );
}

function PayrollSheetInner() {
  const search = useSearchParams();
  const [month, setMonth] = useState<string>(() => search?.get('month') ?? new Date().toISOString().slice(0, 7));
  const [department, setDepartment] = useState('');
  const [employee, setEmployee] = useState('');
  const [paidFilter, setPaidFilter] = useState<'ALL' | 'PAID' | 'UNPAID'>('ALL');
  const [preparedBy, setPreparedBy] = useState(''); // اختياري

  const { data } = useQuery({
    queryKey: ['payroll-sheet', month],
    queryFn: () => api.get(`/employees/payroll?month=${month}`).then((r) => r.data),
  });

  useEffect(() => {
    document.title = `كشف الرواتب الرسمي — ${month}`;
  }, [month]);

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

  const totals = useMemo(() => {
    let baseSalary = 0, totalBonus = 0, totalDeduct = 0, gross = 0, net = 0;
    rows.forEach((r) => {
      const b = Number(r.baseSalary || 0);
      const bonus = Number(r.bonus || 0);
      const overtime = Number(r.overtimePay || 0);
      const totalBonusRow = bonus + overtime;
      const absenceDed = Number(r.absenceDeduction || 0);
      const lateDed = Number(r.lateDeduction || 0);
      const manualDed = Number(r.manualDeduction || 0);
      const totalDedRow = absenceDed + lateDed + manualDed;
      const grossRow = b + totalBonusRow;
      baseSalary += b;
      totalBonus += totalBonusRow;
      totalDeduct += totalDedRow;
      gross += grossRow;
      net += Number(r.net || 0);
    });
    return {
      baseSalary, totalBonus, totalDeduct, gross, net,
      count: rows.length,
      avg: rows.length > 0 ? net / rows.length : 0,
    };
  }, [rows]);

  const departments = useMemo(() => {
    const set = new Set<string>();
    (data?.rows ?? []).forEach((r: any) => r.department && set.add(r.department));
    return Array.from(set).sort();
  }, [data]);

  const exportExcel = () => {
    const BOM = '﻿';
    const headers = [
      '#', 'الاسم', 'القسم', 'المسمى الوظيفي', 'الراتب الأساسي',
      'أيام الحضور', 'أيام الغياب', 'ساعات التأخير', 'ساعات إضافية',
      'أجر الإضافي', 'مكافأة', 'إجمالي البدلات',
      'خصم الغياب', 'خصم التأخير', 'خصومات يدوية', 'إجمالي الخصومات',
      'الإجمالي', 'الصافي', 'الحالة', 'ملاحظات',
    ];
    const rowsCsv = [headers, ...rows.map((r: any, i: number) => {
      const totalBonusRow = Number(r.bonus || 0) + Number(r.overtimePay || 0);
      const totalDedRow = Number(r.absenceDeduction || 0) + Number(r.lateDeduction || 0) + Number(r.manualDeduction || 0);
      const grossRow = Number(r.baseSalary || 0) + totalBonusRow;
      return [
        i + 1, r.fullName, r.department ?? '—', r.position ?? '—', num(r.baseSalary),
        r.presentDays, r.absentDays, num(r.lateHours), num(r.overtimeHours),
        num(r.overtimePay), num(r.bonus), num(totalBonusRow),
        num(r.absenceDeduction), num(r.lateDeduction), num(r.manualDeduction), num(totalDedRow),
        num(grossRow), num(r.net), r.paid ? 'مصروف' : 'غير مصروف', r.notes ?? '—',
      ];
    })];
    rowsCsv.push([
      'الإجماليات', '', '', '', num(totals.baseSalary),
      '', '', '', '', '', '', num(totals.totalBonus),
      '', '', '', num(totals.totalDeduct),
      num(totals.gross), num(totals.net), '', '',
    ]);
    const csv = BOM + rowsCsv.map((r) => r.map((v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `payroll-sheet-${month}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div dir="rtl" className="min-h-screen bg-zinc-100 print:bg-white">
      {/* شريط أدوات — يختفي عند الطباعة */}
      <div className="no-print sticky top-0 z-30 bg-white border-b border-zinc-200 shadow-sm">
        <div className="max-w-[297mm] mx-auto px-4 py-3 flex items-center gap-3 flex-wrap">
          <h2 className="font-black text-lg">كشف الرواتب الرسمي</h2>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
            className="h-9 px-2 rounded border border-zinc-200 text-sm" />
          <Filter className="h-4 w-4 text-zinc-400" />
          <select value={department} onChange={(e) => setDepartment(e.target.value)}
            className="h-9 px-2 rounded border border-zinc-200 text-sm">
            <option value="">كل الأقسام</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <input value={employee} onChange={(e) => setEmployee(e.target.value)}
            placeholder="فلترة بموظف" className="h-9 px-2 rounded border border-zinc-200 text-sm w-40" />
          <select value={paidFilter} onChange={(e) => setPaidFilter(e.target.value as any)}
            className="h-9 px-2 rounded border border-zinc-200 text-sm">
            <option value="ALL">الكل</option>
            <option value="PAID">مصروف</option>
            <option value="UNPAID">غير مصروف</option>
          </select>
          <input value={preparedBy} onChange={(e) => setPreparedBy(e.target.value)}
            placeholder="Prepared by" className="h-9 px-2 rounded border border-zinc-200 text-sm w-36" />
          <div className="flex-1" />
          <button onClick={exportExcel}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700">
            <FileSpreadsheet className="h-4 w-4" /> Excel
          </button>
          <button onClick={() => window.print()}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-zinc-900 text-white text-sm font-bold hover:bg-zinc-800">
            <Printer className="h-4 w-4" /> طباعة / حفظ PDF
          </button>
        </div>
      </div>

      {/* الكشف */}
      <div className="max-w-[297mm] mx-auto p-4 print:p-0">
        <div id="sheet" className="bg-white border border-zinc-200 shadow-sm print:shadow-none print:border-0">
          {/* Header الرسمي */}
          <header className="p-4 border-b-4 border-zinc-900">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-full bg-amber-400 flex items-center justify-center text-white font-black text-lg">
                  ⚙️
                </div>
                <div>
                  <div className="text-xl font-black">{FACTORY_NAME}</div>
                  <div className="text-xs text-zinc-500">Dana Dairy Products Factory</div>
                </div>
              </div>
              <div className="text-center">
                <div className="text-lg font-black bg-amber-300 px-4 py-1 rounded">كشف الرواتب — Payroll Statement</div>
                <div className="text-xs text-zinc-600 mt-1">
                  الشهر: {month.slice(5)} · السنة: {month.slice(0, 4)}
                </div>
              </div>
              <div className="text-xs text-zinc-600 text-left">
                <div>تاريخ التوليد: {new Date().toLocaleDateString('ar-JO')}</div>
                <div>الوقت: {new Date().toLocaleTimeString('ar-JO')}</div>
                <div>أعدّه: {preparedBy || '—'}</div>
              </div>
            </div>
          </header>

          {/* الجدول */}
          <div className="overflow-x-auto p-2">
            <table className="w-full text-[10px] border-collapse">
              <thead>
                <tr className="bg-amber-300">
                  <Th w="24">#</Th>
                  <Th>الاسم</Th>
                  <Th>القسم</Th>
                  <Th>الوظيفة</Th>
                  <ThTint c="blue">الراتب الأساسي</ThTint>
                  <ThTint c="blue">أيام الحضور</ThTint>
                  <ThTint c="blue">أيام الغياب</ThTint>
                  <ThTint c="blue">ساعات التأخير</ThTint>
                  <ThTint c="blue">الساعات الإضافية</ThTint>
                  <ThTint c="green">أجر إضافي</ThTint>
                  <ThTint c="green">مكافآت</ThTint>
                  <ThTint c="green">إجمالي البدلات</ThTint>
                  <ThTint c="orange">خصم الغياب</ThTint>
                  <ThTint c="orange">خصم التأخير</ThTint>
                  <ThTint c="orange">خصومات أخرى</ThTint>
                  <ThTint c="orange">إجمالي الخصومات</ThTint>
                  <ThTint c="cyan">الإجمالي</ThTint>
                  <ThTint c="cyan">الصافي</ThTint>
                  <Th>توقيع الموظف</Th>
                  <Th>توقيع المدير</Th>
                  <Th>ملاحظات</Th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={21} className="p-8 text-center text-zinc-400 border">لا توجد بيانات لهذا الشهر</td></tr>
                ) : rows.map((r: any, i: number) => {
                  const totalBonusRow = Number(r.bonus || 0) + Number(r.overtimePay || 0);
                  const totalDedRow = Number(r.absenceDeduction || 0) + Number(r.lateDeduction || 0) + Number(r.manualDeduction || 0);
                  const grossRow = Number(r.baseSalary || 0) + totalBonusRow;
                  return (
                    <tr key={r.employeeId} className="border-b border-zinc-200 hover:bg-zinc-50">
                      <Td>{i + 1}</Td>
                      <Td strong>{r.fullName}</Td>
                      <Td small>{r.department || '—'}</Td>
                      <Td small>{r.position || '—'}</Td>
                      <TdTint c="blue">{num(r.baseSalary)}</TdTint>
                      <TdTint c="blue">{r.presentDays}</TdTint>
                      <TdTint c="blue">{r.absentDays}</TdTint>
                      <TdTint c="blue">{num(r.lateHours)}</TdTint>
                      <TdTint c="blue">{num(r.overtimeHours)}</TdTint>
                      <TdTint c="green">{num(r.overtimePay)}</TdTint>
                      <TdTint c="green">{num(r.bonus)}</TdTint>
                      <TdTint c="green" strong>{num(totalBonusRow)}</TdTint>
                      <TdTint c="orange">{num(r.absenceDeduction)}</TdTint>
                      <TdTint c="orange">{num(r.lateDeduction)}</TdTint>
                      <TdTint c="orange">{num(r.manualDeduction)}</TdTint>
                      <TdTint c="orange" strong>{num(totalDedRow)}</TdTint>
                      <TdTint c="cyan" strong>{num(grossRow)}</TdTint>
                      <TdTint c="cyan" strong>{num(r.net)}</TdTint>
                      <Td>{'—'}</Td>
                      <Td>{'—'}</Td>
                      <Td small>{r.notes || '—'}</Td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-cyan-100 border-t-2 border-zinc-900 font-black">
                  <Td colSpan={4} strong>الإجماليات · TOTALS</Td>
                  <TdTint c="cyan" strong>{num(totals.baseSalary)}</TdTint>
                  <Td colSpan={4}></Td>
                  <Td colSpan={2}></Td>
                  <TdTint c="green" strong>{num(totals.totalBonus)}</TdTint>
                  <Td colSpan={3}></Td>
                  <TdTint c="orange" strong>{num(totals.totalDeduct)}</TdTint>
                  <TdTint c="cyan" strong>{num(totals.gross)}</TdTint>
                  <TdTint c="cyan" strong>{num(totals.net)}</TdTint>
                  <Td colSpan={3}></Td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Summary box + Signatures */}
          <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <Kpi label="عدد الموظفين" value={totals.count} />
            <Kpi label="متوسط الراتب" value={num(totals.avg)} />
            <Kpi label="إجمالي الرواتب الأساسية" value={num(totals.baseSalary)} tint="blue" />
            <Kpi label="إجمالي البدلات" value={num(totals.totalBonus)} tint="green" />
            <Kpi label="إجمالي الخصومات" value={num(totals.totalDeduct)} tint="orange" />
            <Kpi label="إجمالي الرواتب" value={num(totals.gross)} tint="cyan" />
            <Kpi label="صافي الرواتب" value={num(totals.net)} tint="cyan" />
          </div>

          {/* Signatures */}
          <div className="p-6 grid grid-cols-3 gap-6 border-t border-zinc-200 text-xs">
            {['أعدّه', 'راجعه', 'اعتمده'].map((role) => (
              <div key={role} className="text-center">
                <div className="font-bold mb-8">{role}</div>
                <div className="border-t border-zinc-400 pt-1 text-zinc-500">التوقيع والتاريخ</div>
              </div>
            ))}
          </div>

          <footer className="p-3 border-t border-zinc-200 text-[10px] text-zinc-500 text-center">
            {FACTORY_NAME} · كشف الرواتب الرسمي · {new Date().toLocaleString('ar-JO')}
          </footer>
        </div>
      </div>

      <style jsx global>{`
        @page { size: A4 landscape; margin: 8mm; }
        @media print {
          html, body { background: white !important; }
          .no-print { display: none !important; }
          #sheet { box-shadow: none !important; border: 0 !important; }
          table { page-break-inside: auto; }
          thead { display: table-header-group; }
          tr { page-break-inside: avoid; }
          @page { @bottom-center { content: "صفحة " counter(page) " / " counter(pages); font-family: sans-serif; font-size: 10px; color: #71717a; } }
        }
        table th, table td { border: 1px solid #d4d4d8; padding: 4px 6px; text-align: right; }
      `}</style>
    </div>
  );
}

/* helpers */
function num(v: any) {
  const n = Number(v || 0);
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function Th({ children, w }: { children: React.ReactNode; w?: string }) {
  return <th style={w ? { width: `${w}px` } : undefined} className="font-black text-[10px]">{children}</th>;
}
function ThTint({ children, c }: { children: React.ReactNode; c: 'blue' | 'green' | 'orange' | 'cyan' }) {
  const bg = { blue: 'bg-sky-200', green: 'bg-emerald-200', orange: 'bg-orange-200', cyan: 'bg-cyan-200' }[c];
  return <th className={`${bg} font-black text-[10px]`}>{children}</th>;
}
function Td({
  children, strong, small, colSpan,
}: { children?: React.ReactNode; strong?: boolean; small?: boolean; colSpan?: number }) {
  return <td colSpan={colSpan} className={`${strong ? 'font-black' : ''} ${small ? 'text-[9px]' : ''}`}>{children}</td>;
}
function TdTint({
  children, c, strong, colSpan,
}: { children: React.ReactNode; c: 'blue' | 'green' | 'orange' | 'cyan'; strong?: boolean; colSpan?: number }) {
  const bg = { blue: 'bg-sky-50', green: 'bg-emerald-50', orange: 'bg-orange-50', cyan: 'bg-cyan-50' }[c];
  return <td colSpan={colSpan} className={`${bg} ${strong ? 'font-black' : ''}`}>{children}</td>;
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
