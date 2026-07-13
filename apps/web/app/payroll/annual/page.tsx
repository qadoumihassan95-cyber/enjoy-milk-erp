'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatNumber } from '@/lib/utils';
import { FACTORY_NAME } from '@/lib/branding';

/**
 * تقرير رواتب سنوي (12 شهر) — للطباعة على A4 عرضي.
 * يعرض صفاً لكل شهر بإجمالياته + جدول ملخص لكل موظف بمجموع مستحقاته السنوية.
 */
export default function AnnualPayrollPrintPage() {
  const year = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('year') || String(new Date().getFullYear())
    : String(new Date().getFullYear());

  const { data, isLoading } = useQuery({
    queryKey: ['payroll-annual', year],
    queryFn: () => api.get(`/employees/payroll/annual?year=${year}`).then((r) => r.data),
  });

  useEffect(() => {
    if (!data) return;
    const t = setTimeout(() => window.print(), 500);
    return () => clearTimeout(t);
  }, [data]);

  if (isLoading || !data) {
    return <div style={{ padding: 40, fontFamily: 'Cairo, sans-serif', textAlign: 'center' }}>جاري التحضير...</div>;
  }

  const monthNames = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
  ];

  // اجمع كل الموظفين + مستحقاتهم السنوية
  const byEmployee: Record<string, { name: string; department?: string; monthly: number[]; total: number }> = {};
  for (let m = 0; m < 12; m++) {
    const monthData = data.months[m];
    for (const row of (monthData?.rows ?? [])) {
      if (!byEmployee[row.employeeId]) {
        byEmployee[row.employeeId] = {
          name: row.fullName,
          department: row.department,
          monthly: Array(12).fill(0),
          total: 0,
        };
      }
      byEmployee[row.employeeId].monthly[m] = row.net;
      byEmployee[row.employeeId].total += row.net;
    }
  }
  const employees = Object.values(byEmployee).sort((a, b) => b.total - a.total);

  return (
    <div className="print-root">
      <style jsx global>{`
        @page { size: A4 landscape; margin: 10mm 8mm; }
        html, body { background: #f4f4f5; margin: 0; padding: 0; }
        .print-root {
          font-family: 'Cairo', system-ui, sans-serif;
          color: #18181b;
          direction: rtl;
          max-width: 297mm;
          margin: 0 auto;
          padding: 8mm;
          background: white;
          min-height: 100vh;
        }
        .print-toolbar {
          display: flex; gap: 8px; justify-content: flex-end;
          padding: 12px; background: #fafafa;
          border-bottom: 1px solid #e4e4e7;
          margin: -8mm -8mm 8px -8mm;
        }
        .print-toolbar button {
          font-family: inherit; padding: 8px 16px; border: 1px solid #d4d4d8;
          background: white; border-radius: 8px; cursor: pointer; font-weight: 700; font-size: 13px;
        }
        .print-toolbar button.primary { background: #18181b; color: white; border-color: #18181b; }
        h1.title { margin: 0; font-size: 20px; font-weight: 900; }
        .factory-header {
          display: flex; justify-content: space-between; align-items: flex-start;
          border-bottom: 2px solid #18181b; padding-bottom: 8px; margin-bottom: 10px;
        }
        .factory-name { font-size: 16px; font-weight: 900; }
        .doc-meta { font-size: 11px; text-align: left; color: #52525b; }
        table { width: 100%; border-collapse: collapse; font-size: 10px; }
        th, td { padding: 4px 6px; border: 1px solid #d4d4d8; text-align: right; }
        th { background: #f4f4f5; font-weight: 800; font-size: 9px; text-transform: uppercase; }
        tfoot td { background: #fafafa; font-weight: 900; border-top: 2px solid #18181b; }
        [data-numeric] { font-family: 'JetBrains Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; }
        @media print { .print-toolbar { display: none !important; } }
      `}</style>

      <div className="print-toolbar">
        <button onClick={() => window.history.back()}>← رجوع</button>
        <button className="primary" onClick={() => window.print()}>🖨️ طباعة</button>
      </div>

      <div className="factory-header">
        <div>
          <div className="factory-name">{FACTORY_NAME}</div>
          <h1 className="title" style={{ marginTop: 6 }}>تقرير الرواتب السنوي — عام {year}</h1>
        </div>
        <div className="doc-meta">
          <div>تاريخ الطباعة: {new Date().toLocaleDateString('ar-JO')}</div>
        </div>
      </div>

      {/* جدول الملخّص لكل موظف عبر السنة */}
      <table>
        <thead>
          <tr>
            <th style={{ width: '5%' }}>#</th>
            <th style={{ width: '15%' }}>الموظف</th>
            <th style={{ width: '10%' }}>القسم</th>
            {monthNames.map((m) => <th key={m}>{m}</th>)}
            <th style={{ width: '10%' }}>الإجمالي السنوي</th>
          </tr>
        </thead>
        <tbody>
          {employees.map((e, i) => (
            <tr key={i}>
              <td data-numeric>{i + 1}</td>
              <td>{e.name}</td>
              <td>{e.department || '—'}</td>
              {e.monthly.map((v, m) => (
                <td key={m} data-numeric>{v > 0 ? formatNumber(v, 0) : '—'}</td>
              ))}
              <td data-numeric style={{ fontWeight: 900 }}>{formatNumber(e.total, 0)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>المجموع الشهري</td>
            {Array.from({ length: 12 }).map((_, m) => {
              const s = employees.reduce((sum, e) => sum + e.monthly[m], 0);
              return <td key={m} data-numeric>{formatNumber(s, 0)}</td>;
            })}
            <td data-numeric>{formatNumber(employees.reduce((s, e) => s + e.total, 0), 0)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
