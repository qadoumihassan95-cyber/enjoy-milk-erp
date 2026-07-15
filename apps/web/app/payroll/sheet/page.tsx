'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Printer, FileSpreadsheet, Filter } from 'lucide-react';
import { api } from '@/lib/api';
import { FACTORY_NAME } from '@/lib/branding';
import { computePayrollRow, computePayrollTotals } from '@/lib/payroll-calc';

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

  // مصدر الحقيقة الواحد — نفس الحاسبة التي يستخدمها /payroll التفاعلي.
  // كل صف يمر عبر computePayrollRow(...) الذي يعتمد على القيم المُخزَّنة
  // في الـ backend عند غياب أي تعديلات، فتتطابق أرقام الشاشة والـ PDF والـ Excel.
  const computedRows = useMemo(
    () => rows.map((r: any) => computePayrollRow(r, (data as any)?.settings)),
    [rows, data],
  );
  const totals = useMemo(() => {
    const t = computePayrollTotals(computedRows);
    return { ...t, avg: t.count > 0 ? t.net / t.count : 0 };
  }, [computedRows]);

  const departments = useMemo(() => {
    const set = new Set<string>();
    (data?.rows ?? []).forEach((r: any) => r.department && set.add(r.department));
    return Array.from(set).sort();
  }, [data]);

  const [xlsBusy, setXlsBusy] = useState(false);
  const exportExcel = async () => {
    if (xlsBusy) return;
    setXlsBusy(true);
    try {
      // Lazy-load the shared enterprise xlsx builder — ExcelJS is only fetched
      // when the user actually clicks Export, keeping the initial bundle small.
      const mod = await import('@/lib/xlsx-export');
      if (typeof mod.exportXlsx !== 'function') {
        throw new Error('exportXlsx غير متاح — جرّب تحديث الصفحة');
      }
      await mod.exportXlsx({
      filename: `official-payroll-${month}.xlsx`,
      reportTitle: 'كشف الرواتب الرسمي',
      reportTitleEn: 'Official Payroll Statement',
      generatedBy: preparedBy || undefined,
      branch: 'المصنع الرئيسي',
      currency: 'JOD',
      rtl: true,
      filters: [
        { label: 'الشهر', value: `${month.slice(5)}/${month.slice(0, 4)}` },
        { label: 'القسم', value: department || 'كل الأقسام' },
        { label: 'الموظف', value: employee || 'كل الموظفين' },
        { label: 'حالة الصرف', value: paidFilter === 'PAID' ? 'مصروف' : paidFilter === 'UNPAID' ? 'غير مصروف' : 'الكل' },
        { label: 'أساس الضمان', value: String((data as any)?.settings?.socialSecurityBasis ?? 'BASIC') },
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
          const c = computedRows[i];
          return {
            num: i + 1,
            name: r.fullName,
            base: c.base,
            transport: c.transport,
            overtime: c.overtime,
            gross: c.gross,
            compSS: c.compSS,
            empSS: c.empSS,
            advance: c.advance,
            attend: c.attendance,
            totalDed: c.totalDed,
            net: c.net,
          };
        }),
        totals: {
          num: null,
          name: 'الإجماليات · TOTALS',
          base: totals.baseSalary,
          transport: totals.transport,
          overtime: totals.overtime,
          gross: totals.gross,
          compSS: totals.compSS,
          empSS: totals.empSS,
          advance: totals.advance,
          attend: totals.attendance,
          totalDed: totals.netDed,
          net: totals.net,
        },
        conditions: [
          // خصم دوام أعلى من الطبيعي — تنبيه
          { columnKey: 'attend', when: 'gt', value: 100, bg: 'FFFEE2E2', fg: 'FF991B1B' },
          // صافي راتب صفر — علامة حمراء
          { columnKey: 'net',    when: 'eq', value: 0,   bg: 'FFFEE2E2', fg: 'FF991B1B' },
        ],
        footnote: `إجمالي تكلفة الرواتب على الشركة = مجموع إجمالي الرواتب + مجموع ضمان الشركة = ${num(totals.totalCompanyCost)} د.أ`,
      },
      signatures: ['توقيع الموظف', 'الدائرة المالية', 'اعتماد الإدارة'],
    });
    } catch (err: any) {
      console.error('[payroll-sheet] Excel export failed:', err);
      // eslint-disable-next-line no-alert
      alert(err?.message || 'تعذّر تصدير Excel — راجع الاتصال ثم أعد المحاولة');
    } finally {
      setXlsBusy(false);
    }
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
          <button onClick={exportExcel} disabled={xlsBusy}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-60">
            <FileSpreadsheet className="h-4 w-4" /> {xlsBusy ? 'جارٍ التحضير…' : 'Excel'}
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

          {/* الجدول (12 عمود محاسبي حسب المواصفة) */}
          <div className="overflow-x-auto p-2">
            <table className="w-full text-[10px] border-collapse">
              <thead>
                <tr className="bg-amber-300">
                  <Th w="24">الرقم</Th>
                  <Th>اسم الموظف</Th>
                  <ThTint c="blue">الراتب الأساسي</ThTint>
                  <ThTint c="green">بدل مواصلات</ThTint>
                  <ThTint c="green">عمل إضافي</ThTint>
                  <ThTint c="cyan">إجمالي الراتب</ThTint>
                  <ThTint c="orange">ضمان الشركة 14.25%</ThTint>
                  <ThTint c="orange">ضمان الموظف 7.5%</ThTint>
                  <ThTint c="orange">سلف الموظفين</ThTint>
                  <ThTint c="orange">خصم الدوام</ThTint>
                  <ThTint c="orange">صافي الاقتطاعات</ThTint>
                  <ThTint c="cyan">صافي الراتب</ThTint>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={12} className="p-8 text-center text-zinc-400 border">لا توجد بيانات لهذا الشهر</td></tr>
                ) : rows.map((r: any, i: number) => {
                  const c = computedRows[i];
                  return (
                    <tr key={r.employeeId} className="border-b border-zinc-200 hover:bg-zinc-50">
                      <Td>{i + 1}</Td>
                      <Td strong>{r.fullName}</Td>
                      <TdTint c="blue">{num(c.base)}</TdTint>
                      <TdTint c="green">{num(c.transport)}</TdTint>
                      <TdTint c="green">{num(c.overtime)}</TdTint>
                      <TdTint c="cyan" strong>{num(c.gross)}</TdTint>
                      <TdTint c="orange">{num(c.compSS)}</TdTint>
                      <TdTint c="orange">{num(c.empSS)}</TdTint>
                      <TdTint c="orange">{num(c.advance)}</TdTint>
                      <TdTint c="orange">{num(c.attendance)}</TdTint>
                      <TdTint c="orange" strong>{num(c.totalDed)}</TdTint>
                      <TdTint c="cyan" strong>{num(c.net)}</TdTint>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-cyan-100 border-t-2 border-zinc-900 font-black">
                  <Td colSpan={2} strong>الإجماليات · TOTALS</Td>
                  <TdTint c="blue" strong>{num(totals.baseSalary)}</TdTint>
                  <TdTint c="green" strong>{num(totals.transport)}</TdTint>
                  <TdTint c="green" strong>{num(totals.overtime)}</TdTint>
                  <TdTint c="cyan" strong>{num(totals.gross)}</TdTint>
                  <TdTint c="orange" strong>{num(totals.compSS)}</TdTint>
                  <TdTint c="orange" strong>{num(totals.empSS)}</TdTint>
                  <TdTint c="orange" strong>{num(totals.advance)}</TdTint>
                  <TdTint c="orange" strong>{num(totals.attendance)}</TdTint>
                  <TdTint c="orange" strong>{num(totals.netDed)}</TdTint>
                  <TdTint c="cyan" strong>{num(totals.net)}</TdTint>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Summary box + إجمالي التكلفة على الشركة */}
          <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <Kpi label="عدد الموظفين" value={totals.count} />
            <Kpi label="مجموع الرواتب الأساسية" value={num(totals.baseSalary)} tint="blue" />
            <Kpi label="مجموع بدل المواصلات" value={num(totals.transport)} tint="green" />
            <Kpi label="مجموع العمل الإضافي" value={num(totals.overtime)} tint="green" />
            <Kpi label="مجموع إجمالي الرواتب" value={num(totals.gross)} tint="cyan" />
            <Kpi label="مجموع ضمان الموظفين" value={num(totals.empSS)} tint="orange" />
            <Kpi label="مجموع ضمان الشركة" value={num(totals.compSS)} tint="orange" />
            <Kpi label="مجموع سلف الموظفين" value={num(totals.advance)} tint="orange" />
            <Kpi label="مجموع خصم الدوام" value={num(totals.attendance)} tint="orange" />
            <Kpi label="مجموع صافي الاقتطاعات" value={num(totals.netDed)} tint="orange" />
            <Kpi label="مجموع صافي الرواتب" value={num(totals.net)} tint="cyan" />
            <Kpi label="إجمالي تكلفة الرواتب على الشركة" value={num(totals.totalCompanyCost)} tint="cyan" />
          </div>

          {/* توقيعات: الموظف / المالية / الإدارة */}

          {/* Signatures */}
          <div className="p-6 grid grid-cols-3 gap-6 border-t border-zinc-200 text-xs">
            {['توقيع الموظف', 'الدائرة المالية', 'اعتماد الإدارة'].map((role) => (
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
        /* Screen defaults for the 12-column payroll table.
           On print we override widths so nothing clips on iPhone. */
        #sheet table th, #sheet table td {
          border: 1px solid #d4d4d8;
          padding: 4px 6px;
          text-align: right;
        }

        /* ─── PRINT / SAVE-AS-PDF LAYOUT ───────────────────────────────
           Goal: full 12-column payroll table ALWAYS fits inside one A4
           landscape page width — including iPhone Safari's "Save PDF"
           which uses a stricter renderer than desktop Chrome.

           Techniques:
           1) @page A4 landscape with tight 6mm margins.
           2) Root font-size drops so <t/> and <td/> shrink together.
           3) The .sheet-scale wrapper forces the printed content to be
              exactly the printable width — Safari respects width:100% at
              the @page level, so we anchor everything to the page width.
           4) table-layout: fixed + explicit column widths in percent →
              deterministic layout, no overflow, no column dropped.
           5) overflow: visible on wrappers so the printer sees the full
              table (not the on-screen scroll clip).
           6) -webkit-print-color-adjust: exact keeps colour tints on paper. */
        @page {
          size: A4 landscape;
          margin: 6mm;
        }

        @media print {
          html, body {
            background: white !important;
            width: 297mm;         /* A4 landscape width */
            margin: 0 !important;
            padding: 0 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .no-print { display: none !important; }

          /* Strip on-screen chrome that would consume page width. */
          #sheet {
            box-shadow: none !important;
            border: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          #sheet > * { padding: 4mm 4mm !important; }
          #sheet header { padding: 3mm 4mm !important; }

          /* Kill every horizontal scroll wrapper — the printer must see
             the full table, not the on-screen viewport clip. */
          .overflow-x-auto,
          #sheet .overflow-x-auto {
            overflow: visible !important;
            padding: 0 !important;
            margin: 0 !important;
          }

          /* Shrink base font so 12 columns comfortably fit landscape. */
          #sheet, #sheet * {
            font-size: 8pt !important;
            line-height: 1.15 !important;
          }
          #sheet header * { font-size: 9pt !important; }

          /* Deterministic table layout — no overflow, nothing clipped. */
          #sheet table {
            width: 100% !important;
            table-layout: fixed !important;
            border-collapse: collapse !important;
            page-break-inside: auto;
          }
          #sheet table th,
          #sheet table td {
            padding: 2px 3px !important;
            word-wrap: break-word;
            overflow-wrap: break-word;
            white-space: normal !important;
            border: 0.5pt solid #444 !important;
          }
          /* Column width plan (12 cols total = 100%) */
          #sheet table th:nth-child(1),
          #sheet table td:nth-child(1) { width: 4%; }  /* # */
          #sheet table th:nth-child(2),
          #sheet table td:nth-child(2) { width: 14%; text-align: right; } /* name */
          #sheet table th:nth-child(3),
          #sheet table td:nth-child(3),
          #sheet table th:nth-child(4),
          #sheet table td:nth-child(4),
          #sheet table th:nth-child(5),
          #sheet table td:nth-child(5) { width: 7%; }  /* base, trans, ot */
          #sheet table th:nth-child(6),
          #sheet table td:nth-child(6) { width: 9%; }  /* gross */
          #sheet table th:nth-child(7),
          #sheet table td:nth-child(7),
          #sheet table th:nth-child(8),
          #sheet table td:nth-child(8) { width: 8%; }  /* comp/emp SS */
          #sheet table th:nth-child(9),
          #sheet table td:nth-child(9),
          #sheet table th:nth-child(10),
          #sheet table td:nth-child(10) { width: 7%; } /* advance, attend */
          #sheet table th:nth-child(11),
          #sheet table td:nth-child(11) { width: 8%; } /* totalDed */
          #sheet table th:nth-child(12),
          #sheet table td:nth-child(12) { width: 9%; } /* net */

          thead { display: table-header-group; }
          tfoot { display: table-footer-group; }
          tr { page-break-inside: avoid; }

          /* Signatures block stays on last page */
          #sheet .grid { page-break-inside: avoid; }

          /* Footer page counter */
          @page {
            @bottom-center {
              content: "صفحة " counter(page) " / " counter(pages);
              font-family: sans-serif;
              font-size: 8pt;
              color: #52525b;
            }
          }
        }
      `}</style>
    </div>
  );
}

/* helpers */
function num(v: any) {
  // JOD payroll: 3 خانات عشرية
  const n = Number(v || 0);
  return n.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
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
