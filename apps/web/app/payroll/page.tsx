'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Banknote, Printer } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, Button } from '@/components/ui';
import { api } from '@/lib/api';
import { formatNumber } from '@/lib/utils';

export default function PayrollPage() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));

  const { data, isLoading, error } = useQuery({
    queryKey: ['payroll', month],
    queryFn: () => api.get(`/employees/payroll?month=${month}`).then((r) => r.data),
  });

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
              <p className="text-sm text-zinc-500 mt-0.5">حساب تلقائي حسب الدوام والغياب والإضافي</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
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
        {data?.totals && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-xl bg-zinc-50 border border-zinc-100 p-3">
              <div className="text-[10px] font-bold text-zinc-500 uppercase">إجمالي الرواتب الأساسية</div>
              <div className="text-xl font-black mt-1" data-numeric>{formatNumber(data.totals.baseSalary, 0)}</div>
            </div>
            <div className="rounded-xl bg-red-50 border border-red-100 p-3">
              <div className="text-[10px] font-bold text-red-700 uppercase">إجمالي الخصومات</div>
              <div className="text-xl font-black mt-1 text-red-700" data-numeric>{formatNumber(data.totals.deductions, 0)}</div>
            </div>
            <div className="rounded-xl bg-blue-50 border border-blue-100 p-3">
              <div className="text-[10px] font-bold text-blue-700 uppercase">أجر العمل الإضافي</div>
              <div className="text-xl font-black mt-1 text-blue-700" data-numeric>{formatNumber(data.totals.overtimePay, 0)}</div>
            </div>
            <div className="rounded-xl bg-emerald-600 text-white p-3">
              <div className="text-[10px] font-bold uppercase opacity-90">صافي المستحق</div>
              <div className="text-xl font-black mt-1" data-numeric>{formatNumber(data.totals.net, 0)} د.أ</div>
            </div>
          </div>
        )}

        <Card>
          {isLoading ? (
            <div className="p-8 text-center text-zinc-500">جاري الحساب...</div>
          ) : error ? (
            <div className="p-8 text-center text-amber-600 text-sm">لا تملك صلاحية عرض الرواتب (للمدراء/المحاسب/الموارد البشرية).</div>
          ) : !data?.rows || data.rows.length === 0 ? (
            <div className="p-12 text-center text-zinc-500">لا يوجد موظفون</div>
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
                    <th className="text-right p-2.5 text-[10px] font-bold text-zinc-500 uppercase">أجر إضافي</th>
                    <th className="text-right p-2.5 text-[10px] font-bold text-zinc-500 uppercase">الصافي</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r: any) => (
                    <tr key={r.employeeId} className="border-b border-zinc-100">
                      <td className="p-2.5">
                        <div className="font-medium">{r.fullName}</div>
                        <div className="text-[11px] text-zinc-400">{r.department || '—'}</div>
                      </td>
                      <td className="p-2.5" data-numeric>{formatNumber(r.baseSalary, 0)}</td>
                      <td className="p-2.5" data-numeric>{r.presentDays}</td>
                      <td className="p-2.5" data-numeric>{r.absentDays > 0 ? <span className="text-red-600 font-bold">{r.absentDays}</span> : 0}</td>
                      <td className="p-2.5" data-numeric>{r.lateHours}</td>
                      <td className="p-2.5" data-numeric>{r.overtimeHours}</td>
                      <td className="p-2.5 text-red-600" data-numeric>{formatNumber(r.absenceDeduction + r.lateDeduction, 0)}</td>
                      <td className="p-2.5 text-blue-600" data-numeric>{formatNumber(r.overtimePay, 0)}</td>
                      <td className="p-2.5 font-black text-emerald-700" data-numeric>{formatNumber(r.net, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <p className="text-[11px] text-zinc-400 print:hidden">
          💡 الحساب: اليومية = الراتب ÷ {data?.workingDays ?? 26} يوم · الساعة = اليومية ÷ 8 · الإضافي بمعدل 1.5×. علّم الغياب/التأخير/الإضافي من صفحة الموظفين.
        </p>
      </div>
    </AppShell>
  );
}
