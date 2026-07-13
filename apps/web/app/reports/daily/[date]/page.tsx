'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * تقرير يومي مُجمَّع — جميع ورديات/سجلات اليوم مع المجاميع.
 * - A4 عمودي، RTL
 * - يطبع تلقائياً عند التحميل
 */
export default function DailyAggregatedReport() {
  const params = useParams();
  const date = params.date as string;
  const autoPrint =
    typeof window === 'undefined'
      ? true
      : new URLSearchParams(window.location.search).get('autoPrint') !== '0';

  const { data, isLoading } = useQuery({
    queryKey: ['report-daily-aggregated', date],
    queryFn: () =>
      api.get(`/daily-production/report/daily?date=${date}`).then((r) => r.data),
    enabled: !!date,
  });

  const { data: balance } = useQuery({
    queryKey: ['balance-after-report'],
    queryFn: () =>
      api.get('/daily-production/warehouse-balance').then((r) => r.data),
  });

  const [printed, setPrinted] = useState(false);
  useEffect(() => {
    if (data && autoPrint && !printed) {
      const t = setTimeout(() => {
        window.print();
        setPrinted(true);
      }, 400);
      return () => clearTimeout(t);
    }
  }, [data, autoPrint, printed]);

  if (isLoading || !data) {
    return (
      <div style={{ padding: 40, textAlign: 'center', fontFamily: 'Cairo, sans-serif' }}>
        جاري تحميل التقرير...
      </div>
    );
  }

  const fmtDate = (d: string | Date) => {
    const dt = new Date(d);
    return dt.toLocaleDateString('ar-EG', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const summary = data.summary ?? {};
  const records = data.records ?? [];

  // ─── حساب المجاميع لجميع السجلات ───────────────────
  const allCarton: Record<string, number> = {};
  const allAluminum: Record<string, number> = {};
  const allMilk: Record<string, number> = {};
  const allProduced: Record<string, { cartons: number; pallets: number }> = {};
  const allWaste: Record<string, { qty: number; reasons: Set<string> }> = {};

  for (const r of records) {
    for (const c of r.cartonUsage ?? []) {
      allCarton[c.itemName] = (allCarton[c.itemName] ?? 0) + Number(c.quantity);
    }
    for (const a of r.aluminumUsage ?? []) {
      allAluminum[a.itemName] = (allAluminum[a.itemName] ?? 0) + Number(a.quantity);
    }
    for (const m of r.milkUsage ?? []) {
      const k = m.itemName ?? 'حليب خام';
      allMilk[k] = (allMilk[k] ?? 0) + Number(m.quantity);
    }
    for (const p of r.produced ?? []) {
      if (!allProduced[p.itemName]) {
        allProduced[p.itemName] = { cartons: 0, pallets: 0 };
      }
      allProduced[p.itemName].cartons += Number(p.cartonsTotal);
      allProduced[p.itemName].pallets += Number(p.palletsCount ?? 0);
    }
    for (const w of r.wastages ?? []) {
      if (!allWaste[w.itemName]) {
        allWaste[w.itemName] = { qty: 0, reasons: new Set() };
      }
      allWaste[w.itemName].qty += Number(w.quantity);
      if (w.reason) allWaste[w.itemName].reasons.add(w.reason);
    }
  }

  return (
    <div className="print-root">
      <style jsx global>{`
        @page {
          size: A4 portrait;
          margin: 14mm 12mm 14mm 12mm;
        }
        html,
        body {
          background: #f4f4f5;
          margin: 0;
          padding: 0;
        }
        .print-root {
          font-family: 'Cairo', system-ui, sans-serif;
          color: #18181b;
          direction: rtl;
          max-width: 210mm;
          margin: 0 auto;
          padding: 16mm 14mm;
          background: white;
          min-height: 100vh;
        }
        .print-toolbar {
          position: sticky;
          top: 0;
          background: #fafafa;
          border-bottom: 1px solid #e4e4e7;
          padding: 12px 16px;
          display: flex;
          gap: 8px;
          justify-content: flex-end;
          z-index: 50;
          margin: -16mm -14mm 16px -14mm;
        }
        .print-toolbar button {
          font-family: inherit;
          padding: 8px 16px;
          border: 1px solid #d4d4d8;
          background: white;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 700;
          font-size: 13px;
        }
        .print-toolbar button.primary {
          background: #18181b;
          color: white;
          border-color: #18181b;
        }
        h1.report-title {
          margin: 0;
          font-size: 22px;
          font-weight: 900;
          letter-spacing: -0.02em;
        }
        .factory-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          border-bottom: 2px solid #18181b;
          padding-bottom: 10px;
          margin-bottom: 14px;
        }
        .factory-name {
          font-size: 16px;
          font-weight: 900;
        }
        .factory-sub {
          font-size: 11px;
          color: #71717a;
          margin-top: 2px;
        }
        .doc-meta {
          font-size: 11px;
          text-align: left;
          color: #52525b;
        }
        .doc-meta div {
          margin-bottom: 2px;
        }
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 8px;
          margin-bottom: 14px;
        }
        .stat-card {
          background: #fafafa;
          border: 1px solid #e4e4e7;
          border-radius: 6px;
          padding: 8px 10px;
          text-align: center;
        }
        .stat-card .lbl {
          font-size: 9px;
          color: #71717a;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .stat-card .val {
          font-size: 16px;
          font-weight: 900;
          margin-top: 4px;
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-variant-numeric: tabular-nums;
        }
        section.block {
          margin-bottom: 14px;
          page-break-inside: avoid;
        }
        section.block h2 {
          margin: 0 0 8px 0;
          font-size: 13px;
          font-weight: 900;
          padding: 6px 10px;
          background: #18181b;
          color: white;
          border-radius: 4px;
          display: inline-block;
        }
        table.rt {
          width: 100%;
          border-collapse: collapse;
          font-size: 11px;
        }
        table.rt th {
          background: #f4f4f5;
          color: #3f3f46;
          font-size: 10px;
          font-weight: 800;
          padding: 6px 8px;
          border: 1px solid #d4d4d8;
          text-align: right;
        }
        table.rt td {
          padding: 5px 8px;
          border: 1px solid #e4e4e7;
          text-align: right;
        }
        table.rt tfoot td {
          background: #fafafa;
          font-weight: 900;
          border-top: 2px solid #18181b;
        }
        .empty {
          font-size: 11px;
          color: #a1a1aa;
          padding: 8px;
          text-align: center;
          background: #fafafa;
          border: 1px dashed #d4d4d8;
          border-radius: 4px;
        }
        .two-col {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
        }
        .signatures {
          margin-top: 24px;
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 24px;
          padding-top: 16px;
          border-top: 1px solid #e4e4e7;
        }
        .sig-box {
          text-align: center;
        }
        .sig-box .role {
          font-size: 10px;
          font-weight: 800;
          color: #71717a;
          text-transform: uppercase;
          margin-bottom: 36px;
        }
        .sig-box .line {
          border-top: 1px solid #18181b;
          padding-top: 4px;
          font-size: 10px;
          color: #52525b;
        }
        .footer-note {
          margin-top: 18px;
          font-size: 10px;
          color: #71717a;
          text-align: center;
          border-top: 1px dashed #e4e4e7;
          padding-top: 8px;
        }
        [data-numeric] {
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-variant-numeric: tabular-nums;
        }

        @media print {
          html,
          body {
            background: white !important;
          }
          .print-root {
            padding: 0;
            margin: 0;
            box-shadow: none;
          }
          .print-toolbar {
            display: none !important;
          }
          section.block {
            break-inside: avoid;
          }
        }
      `}</style>

      <div className="print-toolbar">
        <button onClick={() => window.history.back()}>← العودة</button>
        <button className="primary" onClick={() => window.print()}>
          🖨️ طباعة / حفظ PDF
        </button>
      </div>

      {/* ─── الرأس ───────────────────────────────── */}
      <div className="factory-header">
        <div>
          <div className="factory-name">مصنع الدانا لمنتجات الحليب واللبن</div>
          <div className="factory-sub">Enjoy Milk · مصنع حليب البودرة</div>
          <h1 className="report-title" style={{ marginTop: 8 }}>
            تقرير الإنتاج اليومي المُجمَّع
          </h1>
        </div>
        <div className="doc-meta">
          <div>
            <strong>التاريخ:</strong> {fmtDate(date)}
          </div>
          <div>
            <strong>عدد السجلات:</strong>{' '}
            <span data-numeric>{records.length}</span>
          </div>
          <div>
            <strong>طُبع في:</strong> {new Date().toLocaleString('ar-EG')}
          </div>
        </div>
      </div>

      {/* ─── الإحصائيات السريعة ───────────────────── */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="lbl">سجلات</div>
          <div className="val">{records.length}</div>
        </div>
        <div className="stat-card">
          <div className="lbl">كراتين منتجة</div>
          <div className="val">
            {(summary.totalCartons ?? 0).toLocaleString('en-US')}
          </div>
        </div>
        <div className="stat-card">
          <div className="lbl">طبليات</div>
          <div className="val">
            {(summary.totalPallets ?? 0).toLocaleString('en-US')}
          </div>
        </div>
        <div className="stat-card">
          <div className="lbl">حليب خام (L)</div>
          <div className="val">
            {(summary.totalMilk ?? 0).toLocaleString('en-US')}
          </div>
        </div>
        <div className="stat-card">
          <div className="lbl">كرتون مستهلك</div>
          <div className="val">
            {(summary.totalCartonUsage ?? 0).toLocaleString('en-US')}
          </div>
        </div>
      </div>

      {records.length === 0 ? (
        <div className="empty">لا توجد سجلات إنتاج في هذا اليوم</div>
      ) : (
        <>
          {/* ─── 1) إجمالي المواد الخام ────────────── */}
          <section className="block">
            <h2>1) إجمالي المواد الخام المسحوبة</h2>
            <div className="two-col">
              <div>
                <strong style={{ fontSize: 11 }}>📦 الكرتون</strong>
                {Object.keys(allCarton).length === 0 ? (
                  <div className="empty" style={{ marginTop: 4 }}>—</div>
                ) : (
                  <table className="rt" style={{ marginTop: 4 }}>
                    <thead>
                      <tr>
                        <th>الصنف</th>
                        <th style={{ width: '35%' }}>الكمية</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(allCarton).map(([name, qty]) => (
                        <tr key={name}>
                          <td>{name}</td>
                          <td data-numeric>{qty.toLocaleString('en-US')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div>
                <strong style={{ fontSize: 11 }}>🥫 الألمنيوم</strong>
                {Object.keys(allAluminum).length === 0 ? (
                  <div className="empty" style={{ marginTop: 4 }}>—</div>
                ) : (
                  <table className="rt" style={{ marginTop: 4 }}>
                    <thead>
                      <tr>
                        <th>الصنف</th>
                        <th style={{ width: '35%' }}>الكمية</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(allAluminum).map(([name, qty]) => (
                        <tr key={name}>
                          <td>{name}</td>
                          <td data-numeric>{qty.toLocaleString('en-US')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div style={{ marginTop: 10 }}>
              <strong style={{ fontSize: 11 }}>🥛 الحليب الخام</strong>
              {Object.keys(allMilk).length === 0 ? (
                <div className="empty" style={{ marginTop: 4 }}>—</div>
              ) : (
                <table className="rt" style={{ marginTop: 4 }}>
                  <thead>
                    <tr>
                      <th>الصنف</th>
                      <th style={{ width: '20%' }}>الكمية (L)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(allMilk).map(([name, qty]) => (
                      <tr key={name}>
                        <td>{name}</td>
                        <td data-numeric>{qty.toLocaleString('en-US')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          {/* ─── 2) إجمالي المنتج النهائي والتوالف ──── */}
          <section className="block">
            <h2>2) إجمالي الإنتاج والتوالف</h2>
            <div style={{ marginBottom: 10 }}>
              <strong style={{ fontSize: 11 }}>✅ المنتج النهائي</strong>
              {Object.keys(allProduced).length === 0 ? (
                <div className="empty" style={{ marginTop: 4 }}>لا يوجد إنتاج</div>
              ) : (
                <table className="rt" style={{ marginTop: 4 }}>
                  <thead>
                    <tr>
                      <th>المنتج</th>
                      <th style={{ width: '20%' }}>الطبليات</th>
                      <th style={{ width: '20%' }}>الكراتين</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(allProduced).map(([name, v]) => (
                      <tr key={name}>
                        <td>{name}</td>
                        <td data-numeric>{v.pallets.toLocaleString('en-US')}</td>
                        <td data-numeric>
                          <strong>{v.cartons.toLocaleString('en-US')}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>الإجمالي</td>
                      <td data-numeric>
                        {(summary.totalPallets ?? 0).toLocaleString('en-US')}
                      </td>
                      <td data-numeric>
                        {(summary.totalCartons ?? 0).toLocaleString('en-US')}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>

            <div>
              <strong style={{ fontSize: 11 }}>⚠️ التوالف</strong>
              {Object.keys(allWaste).length === 0 ? (
                <div className="empty" style={{ marginTop: 4 }}>
                  لا توجد توالف 🎉
                </div>
              ) : (
                <table className="rt" style={{ marginTop: 4 }}>
                  <thead>
                    <tr>
                      <th>الصنف</th>
                      <th style={{ width: '15%' }}>الكمية</th>
                      <th>الأسباب</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(allWaste).map(([name, v]) => (
                      <tr key={name}>
                        <td>{name}</td>
                        <td data-numeric>{v.qty.toLocaleString('en-US')}</td>
                        <td style={{ fontSize: 10 }}>
                          {Array.from(v.reasons).join('، ') || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          {/* ─── 3) جدول السجلات اليومي ─────────────── */}
          <section className="block">
            <h2>3) سجلات اليوم</h2>
            <table className="rt">
              <thead>
                <tr>
                  <th style={{ width: '4%' }}>#</th>
                  <th>الشيفت</th>
                  <th>المشغّل</th>
                  <th style={{ width: '8%' }}>الماكينة</th>
                  <th style={{ width: '12%' }}>كراتين</th>
                  <th style={{ width: '10%' }}>توالف</th>
                  <th style={{ width: '12%' }}>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r: any, i: number) => {
                  const c = (r.produced ?? []).reduce(
                    (s: number, p: any) => s + Number(p.cartonsTotal || 0),
                    0,
                  );
                  const w = (r.wastages ?? []).reduce(
                    (s: number, ww: any) => s + Number(ww.quantity || 0),
                    0,
                  );
                  return (
                    <tr key={r.id}>
                      <td data-numeric>{i + 1}</td>
                      <td>{r.shift || '—'}</td>
                      <td>{r.operatorName || '—'}</td>
                      <td data-numeric>{r.machineNumber || '—'}</td>
                      <td data-numeric>
                        <strong>{c.toLocaleString('en-US')}</strong>
                      </td>
                      <td data-numeric>{w.toLocaleString('en-US')}</td>
                      <td>
                        {r.status === 'POSTED'
                          ? '✓ مُرحَّل'
                          : r.status === 'CANCELLED'
                            ? '✗ ملغي'
                            : '○ مسودة'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          {/* ─── 4) رصيد المستودع ───────────────────── */}
          {balance && (
            <section className="block">
              <h2>4) رصيد المستودع الحالي</h2>
              <div className="two-col">
                <div>
                  <strong style={{ fontSize: 11 }}>🥛 الحليب الخام</strong>
                  {(balance.milk ?? []).length === 0 ? (
                    <div className="empty" style={{ marginTop: 4 }}>—</div>
                  ) : (
                    <table className="rt" style={{ marginTop: 4 }}>
                      <thead>
                        <tr>
                          <th>الصنف</th>
                          <th style={{ width: '40%' }}>الرصيد</th>
                        </tr>
                      </thead>
                      <tbody>
                        {balance.milk.map((b: any) => (
                          <tr key={b.id}>
                            <td style={{ fontSize: 10 }}>{b.name}</td>
                            <td data-numeric>
                              {Number(b.balance).toLocaleString('en-US')} {b.unit}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                <div>
                  <strong style={{ fontSize: 11 }}>📦 الكرتون + 🥫 الألمنيوم</strong>
                  {[...(balance.carton ?? []), ...(balance.aluminum ?? [])]
                    .length === 0 ? (
                    <div className="empty" style={{ marginTop: 4 }}>—</div>
                  ) : (
                    <table className="rt" style={{ marginTop: 4 }}>
                      <thead>
                        <tr>
                          <th>الصنف</th>
                          <th style={{ width: '40%' }}>الرصيد</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ...(balance.carton ?? []),
                          ...(balance.aluminum ?? []),
                        ].map((b: any) => (
                          <tr key={b.id}>
                            <td style={{ fontSize: 10 }}>{b.name}</td>
                            <td data-numeric>
                              {Number(b.balance).toLocaleString('en-US')} {b.unit}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </section>
          )}
        </>
      )}

      {/* ─── التوقيعات ────────────────────────────────── */}
      <div className="signatures">
        <div className="sig-box">
          <div className="role">رئيس الإنتاج</div>
          <div className="line">
            الاسم: ____________
            <br />
            التوقيع: ____________
          </div>
        </div>
        <div className="sig-box">
          <div className="role">المدير الفني</div>
          <div className="line">
            الاسم: ____________
            <br />
            التوقيع: ____________
          </div>
        </div>
        <div className="sig-box">
          <div className="role">المدير العام</div>
          <div className="line">
            الاسم: ____________
            <br />
            التوقيع: ____________
          </div>
        </div>
      </div>

      <div className="footer-note">
        نظام Enjoy Milk ERP · مصنع الدانا لمنتجات الحليب واللبن · تقرير يومي مُجمَّع · طُبع في{' '}
        {new Date().toLocaleString('ar-EG')}
      </div>
    </div>
  );
}
