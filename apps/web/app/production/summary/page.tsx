'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Filter, Package, BarChart3, Printer, FileText } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, CardHeader, CardTitle, CardContent, Stat } from '@/components/ui';
import { api } from '@/lib/api';
import { formatNumber } from '@/lib/utils';
import { FACTORY_NAME } from '@/lib/branding';

/**
 * ملخص الإنتاج اليومي — مصدر واحد للحقيقة يحسب من
 *   GET /daily-production/summary/day?date=YYYY-MM-DD
 * وهذا هو نفس المصدر الذي يستهلكه الآن Dashboard "إنتاج اليوم"
 * (عبر DailyProductionService.getTodayProductionSummary الذي
 *  يفوّض إلى getDailySummary داخلياً). فلا مجال لخلاف الأرقام.
 *
 * أضيف زرا "طباعة" و "PDF":
 *   طباعة → طباعة مباشرة (A4 عمودي / RTL / إخفاء الواجهة).
 *   PDF   → نفس التخطيط لكن نُغيّر عنوان المستند لاسم الملف
 *           المطلوب "daily-production-summary-YYYY-MM-DD" ثم
 *           نفتح حوار الطباعة — من "الوجهة" يختار المستخدم
 *           "Save as PDF" فيحصل على PDF منسق (نص عربي قابل
 *           للتحديد، RTL صحيح، ليس صورة).
 */
export default function DailySummaryPage() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [itemName, setItemName] = useState('');
  const [printError, setPrintError] = useState<string | null>(null);

  const {
    data: summary,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['day-summary', date, itemName],
    queryFn: () => {
      const p = new URLSearchParams();
      p.set('date', date);
      if (itemName) p.set('itemName', itemName);
      return api.get(`/daily-production/summary/day?${p.toString()}`).then((r) => r.data);
    },
    retry: 1,
  });

  const totals = summary?.totals ?? {};

  // Restore original document title on unmount, so back navigation
  // does not leave the "daily-production-summary-..." title behind.
  useEffect(() => {
    const original = document.title;
    return () => {
      document.title = original;
    };
  }, []);

  const doPrint = () => {
    setPrintError(null);
    if (!summary || isError) {
      setPrintError('لا توجد بيانات كافية للطباعة');
      return;
    }
    document.title = `ملخص الإنتاج اليومي — ${date}`;
    setTimeout(() => window.print(), 50);
  };
  const doPdf = () => {
    setPrintError(null);
    if (!summary || isError) {
      setPrintError('لا توجد بيانات كافية لتوليد PDF');
      return;
    }
    // Chrome uses document.title as the default "Save as PDF" filename.
    document.title = `daily-production-summary-${date}`;
    setTimeout(() => window.print(), 50);
  };

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto p-3 md:p-6 space-y-4 md:space-y-6 pb-24 md:pb-6" data-summary-root>
        <header className="flex items-center justify-between flex-wrap gap-3 no-print">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-zinc-900 text-white flex items-center justify-center">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-black tracking-tight">ملخص الإنتاج اليومي</h1>
              <p className="text-sm text-zinc-500 mt-0.5">إجمالي إنتاج اليوم + المواد الخام + نسبة الفاقد</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={doPrint}
              disabled={!summary || isError || isLoading}
              className="inline-flex items-center gap-1.5 h-10 px-3 rounded-lg border border-zinc-200 bg-white text-sm font-bold hover:bg-zinc-50 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              title="طباعة على A4"
            >
              <Printer className="h-4 w-4" />
              طباعة
            </button>
            <button
              type="button"
              onClick={doPdf}
              disabled={!summary || isError || isLoading}
              className="inline-flex items-center gap-1.5 h-10 px-3 rounded-lg bg-zinc-900 text-white text-sm font-bold hover:bg-zinc-800 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              title="تصدير كـ PDF"
            >
              <FileText className="h-4 w-4" />
              PDF
            </button>
          </div>
        </header>

        {/* الفلاتر */}
        <Card className="p-3 flex items-center gap-3 flex-wrap no-print">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-zinc-400" />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-10 px-3 rounded-lg border border-zinc-200 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-zinc-400" />
            <input
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="فلتر بالمنتج"
              className="h-10 px-3 rounded-lg border border-zinc-200 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            className="ms-auto h-10 px-3 rounded-lg border border-zinc-200 text-sm hover:bg-zinc-50"
            title="تحديث البيانات"
          >
            تحديث
          </button>
        </Card>

        {printError && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 text-amber-800 px-3 py-2 text-sm no-print">
            {printError}
          </div>
        )}

        {isLoading ? (
          <Card className="p-8 text-center text-zinc-500">جاري التحميل...</Card>
        ) : isError ? (
          <Card className="p-8 text-center">
            <div className="text-red-600 font-bold mb-1">تعذر تحميل ملخص الإنتاج</div>
            <div className="text-xs text-zinc-500">تحقق من الاتصال ثم اضغط "تحديث"</div>
          </Card>
        ) : summary?.recordsCount === 0 ? (
          <Card className="p-12 text-center">
            <p className="text-zinc-500">لا يوجد إنتاج مُسجَّل لهذا اليوم</p>
            <p className="text-xs text-zinc-400 mt-1">أنشئ ورقة إنتاج من صفحة الإنتاج اليومي</p>
          </Card>
        ) : (
          <>
            {/* ─── PRINT HEADER — يظهر فقط عند الطباعة/PDF ─── */}
            <div className="print-only print-header">
              <div className="print-brand">{FACTORY_NAME}</div>
              <div className="print-title">ملخص الإنتاج اليومي</div>
              <div className="print-meta">
                <span>التاريخ: {new Date(date).toLocaleDateString('ar-JO', { dateStyle: 'long' })}</span>
                {itemName && <span> · فلتر: {itemName}</span>}
              </div>
            </div>

            {/* إجماليات */}
            <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 print-grid">
              <Stat label="إجمالي الكراتين المنتجة" value={formatNumber(totals.cartons ?? 0, 0)} state="good" />
              <Stat label="إجمالي الطبالي" value={formatNumber(totals.pallets ?? 0, 0)} />
              <Stat
                label="إجمالي الحليب الخام (كغ)"
                value={formatNumber(totals.rawMilkKg ?? 0, 1)}
                hint={
                  (totals.milkBags ?? 0) > 0
                    ? `${totals.milkBags} كيس × ${totals.bagWeightKg ?? 25} كغ`
                    : 'بلا أكياس'
                }
              />
              <Stat
                label="نسبة الفاقد"
                value={`${totals.wasteRate ?? 0}%`}
                state={(totals.wasteRate ?? 0) > 5 ? 'danger' : (totals.wasteRate ?? 0) > 2 ? 'warning' : 'good'}
                hint={`فاقد: ${formatNumber(totals.waste ?? 0, 1)}`}
              />
            </section>

            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 print-grid">
              <div className="rounded-xl bg-zinc-50 border border-zinc-100 p-3">
                <div className="text-[10px] font-bold text-zinc-500 uppercase">كرتون مسحوب</div>
                <div className="text-lg font-black mt-1" data-numeric>{formatNumber(totals.cartonUsage ?? 0, 1)}</div>
              </div>
              <div className="rounded-xl bg-zinc-50 border border-zinc-100 p-3">
                <div className="text-[10px] font-bold text-zinc-500 uppercase">ألمنيوم</div>
                <div className="text-lg font-black mt-1" data-numeric>{formatNumber(totals.aluminum ?? 0, 1)}</div>
              </div>
              <div className="rounded-xl bg-amber-50 border border-amber-100 p-3">
                <div className="text-[10px] font-bold text-amber-700 uppercase">عدد أوراق الإنتاج</div>
                <div className="text-lg font-black mt-1 text-amber-700" data-numeric>{summary.recordsCount}</div>
              </div>
            </div>

            {/* تفصيل لكل منتج */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Package className="h-4 w-4" /> إنتاج كل منتج</CardTitle>
              </CardHeader>
              <CardContent>
                {Object.keys(summary.byItem ?? {}).length === 0 ? (
                  <p className="text-sm text-zinc-400 text-center py-4">لا توجد بيانات</p>
                ) : (
                  <div className="space-y-2">
                    {Object.entries(summary.byItem).map(([item, info]: any) => (
                      <div key={item} className="rounded-lg border border-zinc-100 p-3 flex items-center justify-between flex-wrap gap-2">
                        <div className="font-bold text-sm">{item}</div>
                        <div className="text-sm">
                          <span className="text-emerald-700 font-black" data-numeric>
                            {formatNumber(info.totalCartons, 0)}
                          </span>
                          <span className="text-zinc-500 text-xs">
                            {' '}كرتون · {formatNumber(info.totalPallets, 0)} طبلية
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* الملاحظات */}
            {summary.notes?.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>📝 ملاحظات اليوم</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm">
                    {summary.notes.map((n: string, i: number) => (
                      <li key={i} className="rounded bg-zinc-50 p-2 border border-zinc-100">{n}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* ─── PRINT FOOTER — طُبع في / بواسطة ─── */}
            <div className="print-only print-footer">
              طُبع في: {new Date().toLocaleString('ar-JO', { dateStyle: 'medium', timeStyle: 'short' })}
              &nbsp;·&nbsp; {FACTORY_NAME}
            </div>
          </>
        )}
      </div>

      {/* ─── PRINT STYLES ─────────────────────────────────
           Hide app chrome (sidebar, header, filters, buttons).
           Show only the report content on clean A4 RTL.
           This CSS is scoped to this page via the parent
           [data-summary-root]. Runs for @media print AND is
           equivalent to what the user gets in "Save as PDF"
           (Chrome renders the print stylesheet).                 */}
      <style jsx global>{`
        .print-only { display: none; }

        @media print {
          @page { size: A4 portrait; margin: 12mm 10mm; }

          html, body { background: #fff !important; }

          /* Hide app chrome globally when printing. */
          nav, aside, header:not(.print-header),
          .no-print, [data-navigation], [data-app-shell-sidebar],
          [data-app-shell-header], [data-mobile-nav],
          [data-hide-in-print] { display: none !important; }

          /* Reset AppShell padding & shadows for a clean sheet. */
          body [data-app-shell-root],
          body [data-app-shell-main] {
            padding: 0 !important;
            margin: 0 !important;
            background: #fff !important;
          }

          [data-summary-root] {
            max-width: none !important;
            padding: 0 !important;
            margin: 0 !important;
            direction: rtl !important;
          }

          .print-only { display: block !important; }

          .print-header {
            text-align: center;
            border-bottom: 2px solid #111;
            padding-bottom: 8pt;
            margin-bottom: 10pt;
          }
          .print-header .print-brand {
            font-size: 13pt;
            font-weight: 800;
            letter-spacing: 0;
          }
          .print-header .print-title {
            font-size: 18pt;
            font-weight: 900;
            margin-top: 2pt;
          }
          .print-header .print-meta {
            font-size: 10pt;
            color: #444;
            margin-top: 2pt;
          }

          .print-footer {
            margin-top: 14pt;
            padding-top: 6pt;
            border-top: 1px solid #ccc;
            font-size: 9pt;
            color: #444;
            text-align: center;
          }

          .print-grid { break-inside: avoid; }
          [data-summary-root] .rounded-xl,
          [data-summary-root] .rounded-2xl,
          [data-summary-root] .rounded-lg {
            box-shadow: none !important;
          }

          /* Recharts / icons hidden in the print output. */
          svg[data-lucide] { width: 12pt; height: 12pt; }
        }
      `}</style>
    </AppShell>
  );
}
