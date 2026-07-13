'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * صفحة طباعة احترافية لورقة إنتاج يومية واحدة.
 * - A4 عمودي، RTL، خط Cairo
 * - تطبع تلقائياً عند التحميل (يمكن تعطيلها بـ ?autoPrint=0)
 * - تنسيق @media print لإخفاء أزرار الواجهة عند الطباعة
 */
export default function ProductionPrintPage() {
  const params = useParams();
  const id = params.id as string;
  // نقرأ autoPrint من window.location مباشرة لتفادي الحاجة لـ Suspense
  const autoPrint =
    typeof window === 'undefined'
      ? true
      : new URLSearchParams(window.location.search).get('autoPrint') !== '0';

  const { data, isLoading } = useQuery({
    queryKey: ['daily-production-print', id],
    queryFn: () => api.get(`/daily-production/${id}`).then((r) => r.data),
    enabled: !!id,
  });

  const { data: balance } = useQuery({
    queryKey: ['daily-production-balance'],
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

  const statusLabel =
    data.status === 'POSTED'
      ? 'مُرحَّل للمخزون'
      : data.status === 'CANCELLED'
        ? 'ملغي'
        : 'مسودة';

  // ─── Totals ─────────────────────────────────
  const cartonTotal = (data.cartonUsage ?? []).reduce(
    (s: number, r: any) => s + Number(r.quantity || 0),
    0,
  );
  const aluminumTotal = (data.aluminumUsage ?? []).reduce(
    (s: number, r: any) => s + Number(r.quantity || 0),
    0,
  );
  const milkTotal = (data.milkUsage ?? []).reduce(
    (s: number, r: any) => s + Number(r.quantity || 0),
    0,
  );
  const producedTotalCartons = (data.produced ?? []).reduce(
    (s: number, r: any) => s + Number(r.cartonsTotal || 0),
    0,
  );
  const producedTotalPallets = (data.produced ?? []).reduce(
    (s: number, r: any) => s + Number(r.palletsCount || 0),
    0,
  );
  const wasteTotal = (data.wastages ?? []).reduce(
    (s: number, r: any) => s + Number(r.quantity || 0),
    0,
  );

  return (
    <div className="print-root">
      {/* ─── أنماط الصفحة + الطباعة ───────────────────────── */}
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
          color: #18181b;
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
        .info-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 10px;
          background: #fafafa;
          border: 1px solid #e4e4e7;
          border-radius: 6px;
          padding: 10px 12px;
          margin-bottom: 14px;
          font-size: 12px;
        }
        .info-grid .lbl {
          color: #71717a;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .info-grid .val {
          font-weight: 700;
          margin-top: 2px;
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
        table.report-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }
        table.report-table th {
          background: #f4f4f5;
          color: #3f3f46;
          font-size: 10px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 6px 8px;
          border: 1px solid #d4d4d8;
          text-align: right;
        }
        table.report-table td {
          padding: 6px 8px;
          border: 1px solid #e4e4e7;
          text-align: right;
        }
        table.report-table tfoot td {
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
          margin-top: 28px;
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
          letter-spacing: 0.04em;
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
        .status-pill {
          display: inline-block;
          padding: 3px 10px;
          border-radius: 999px;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.04em;
        }
        .status-POSTED {
          background: #dcfce7;
          color: #14532d;
        }
        .status-DRAFT {
          background: #fef3c7;
          color: #78350f;
        }
        .status-CANCELLED {
          background: #fee2e2;
          color: #7f1d1d;
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
            box-shadow: none;
            padding: 0;
            margin: 0;
          }
          .print-toolbar {
            display: none !important;
          }
          section.block {
            break-inside: avoid;
          }
          .signatures {
            break-inside: avoid;
          }
        }
      `}</style>

      {/* ─── شريط الأدوات (مخفي عند الطباعة) ────────────────── */}
      <div className="print-toolbar">
        <button onClick={() => window.history.back()}>← العودة</button>
        <button className="primary" onClick={() => window.print()}>
          🖨️ طباعة / حفظ PDF
        </button>
      </div>

      {/* ─── الرأس الرسمي ───────────────────────────────── */}
      <div className="factory-header">
        <div>
          <div className="factory-name">مصنع الدانا لمنتجات الحليب واللبن</div>
          <div className="factory-sub">Enjoy Milk · مصنع حليب البودرة</div>
          <h1 className="report-title" style={{ marginTop: 8 }}>
            ورقة إنتاج يومية
          </h1>
        </div>
        <div className="doc-meta">
          <div>
            <strong>التاريخ:</strong> {fmtDate(data.productionDate)}
          </div>
          <div>
            <strong>رقم السجل:</strong>{' '}
            <span data-numeric>{(data.id ?? '').slice(0, 8).toUpperCase()}</span>
          </div>
          <div>
            <strong>الحالة:</strong>{' '}
            <span className={`status-pill status-${data.status}`}>
              {statusLabel}
            </span>
          </div>
          {data.postedAt && (
            <div>
              <strong>تاريخ الترحيل:</strong> {fmtDate(data.postedAt)}
            </div>
          )}
        </div>
      </div>

      {/* ─── معلومات الورقة ─────────────────────────────── */}
      <div className="info-grid">
        <div>
          <div className="lbl">الشيفت</div>
          <div className="val">{data.shift || '—'}</div>
        </div>
        <div>
          <div className="lbl">المشغّل</div>
          <div className="val">{data.operatorName || '—'}</div>
        </div>
        <div>
          <div className="lbl">تاريخ الإنشاء</div>
          <div className="val">{fmtDate(data.createdAt)}</div>
        </div>
      </div>

      {/* ─── 1) المواد الخام ─────────────────────────── */}
      <section className="block">
        <h2>1) المواد الخام المسحوبة من المستودع</h2>

        <div style={{ marginBottom: 10 }}>
          <strong style={{ fontSize: 12 }}>📦 الكرتون</strong>
          {(data.cartonUsage ?? []).length === 0 ? (
            <div className="empty" style={{ marginTop: 4 }}>
              لا يوجد سحب كرتون
            </div>
          ) : (
            <table className="report-table" style={{ marginTop: 4 }}>
              <thead>
                <tr>
                  <th style={{ width: '5%' }}>#</th>
                  <th>الصنف</th>
                  <th style={{ width: '20%' }}>الكمية</th>
                </tr>
              </thead>
              <tbody>
                {data.cartonUsage.map((r: any, i: number) => (
                  <tr key={r.id ?? i}>
                    <td data-numeric>{i + 1}</td>
                    <td>{r.itemName}</td>
                    <td data-numeric>{Number(r.quantity).toLocaleString('en-US')}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>الإجمالي</td>
                  <td data-numeric>{cartonTotal.toLocaleString('en-US')}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        <div style={{ marginBottom: 10 }}>
          <strong style={{ fontSize: 12 }}>🥫 الألمنيوم</strong>
          {(data.aluminumUsage ?? []).length === 0 ? (
            <div className="empty" style={{ marginTop: 4 }}>
              لا يوجد سحب ألمنيوم
            </div>
          ) : (
            <table className="report-table" style={{ marginTop: 4 }}>
              <thead>
                <tr>
                  <th style={{ width: '5%' }}>#</th>
                  <th>الصنف</th>
                  <th style={{ width: '20%' }}>الكمية</th>
                </tr>
              </thead>
              <tbody>
                {data.aluminumUsage.map((r: any, i: number) => (
                  <tr key={r.id ?? i}>
                    <td data-numeric>{i + 1}</td>
                    <td>{r.itemName}</td>
                    <td data-numeric>{Number(r.quantity).toLocaleString('en-US')}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>الإجمالي</td>
                  <td data-numeric>{aluminumTotal.toLocaleString('en-US')}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        <div>
          <strong style={{ fontSize: 12 }}>🥛 الحليب الخام</strong>
          {(data.milkUsage ?? []).length === 0 ? (
            <div className="empty" style={{ marginTop: 4 }}>
              لا يوجد سحب حليب
            </div>
          ) : (
            <table className="report-table" style={{ marginTop: 4 }}>
              <thead>
                <tr>
                  <th style={{ width: '5%' }}>#</th>
                  <th>الصنف</th>
                  <th style={{ width: '15%' }}>عدد العبوات</th>
                  <th style={{ width: '20%' }}>الكمية</th>
                  <th style={{ width: '10%' }}>الوحدة</th>
                </tr>
              </thead>
              <tbody>
                {data.milkUsage.map((r: any, i: number) => (
                  <tr key={r.id ?? i}>
                    <td data-numeric>{i + 1}</td>
                    <td>{r.itemName ?? '—'}</td>
                    <td data-numeric>{r.count ?? '—'}</td>
                    <td data-numeric>{Number(r.quantity).toLocaleString('en-US')}</td>
                    <td>{r.unit ?? 'KG'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>الإجمالي</td>
                  <td data-numeric>{milkTotal.toLocaleString('en-US')}</td>
                  <td>—</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </section>

      {/* ─── 2) المنتج النهائي + التوالف ───────────────── */}
      <section className="block">
        <h2>2) المنتج النهائي والتوالف</h2>

        <div style={{ marginBottom: 10 }}>
          <strong style={{ fontSize: 12 }}>✅ المنتج النهائي</strong>
          {(data.produced ?? []).length === 0 ? (
            <div className="empty" style={{ marginTop: 4 }}>
              لا يوجد إنتاج
            </div>
          ) : (
            <table className="report-table" style={{ marginTop: 4 }}>
              <thead>
                <tr>
                  <th style={{ width: '5%' }}>#</th>
                  <th>المنتج</th>
                  <th style={{ width: '15%' }}>الطبليات</th>
                  <th style={{ width: '15%' }}>إجمالي الكراتين</th>
                  <th>ملاحظات</th>
                </tr>
              </thead>
              <tbody>
                {data.produced.map((p: any, i: number) => (
                  <tr key={p.id ?? i}>
                    <td data-numeric>{i + 1}</td>
                    <td>{p.itemName}</td>
                    <td data-numeric>{p.palletsCount ?? 0}</td>
                    <td data-numeric>
                      <strong>{Number(p.cartonsTotal).toLocaleString('en-US')}</strong>
                    </td>
                    <td>{p.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>الإجمالي</td>
                  <td data-numeric>{producedTotalPallets.toLocaleString('en-US')}</td>
                  <td data-numeric>{producedTotalCartons.toLocaleString('en-US')}</td>
                  <td>—</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        <div>
          <strong style={{ fontSize: 12 }}>⚠️ التوالف</strong>
          {(data.wastages ?? []).length === 0 ? (
            <div className="empty" style={{ marginTop: 4 }}>
              لا توجد توالف 🎉
            </div>
          ) : (
            <table className="report-table" style={{ marginTop: 4 }}>
              <thead>
                <tr>
                  <th style={{ width: '5%' }}>#</th>
                  <th>الصنف</th>
                  <th style={{ width: '15%' }}>الكمية</th>
                  <th style={{ width: '10%' }}>الوحدة</th>
                  <th>السبب</th>
                </tr>
              </thead>
              <tbody>
                {data.wastages.map((w: any, i: number) => (
                  <tr key={w.id ?? i}>
                    <td data-numeric>{i + 1}</td>
                    <td>{w.itemName}</td>
                    <td data-numeric>{Number(w.quantity).toLocaleString('en-US')}</td>
                    <td>{w.unit ?? 'PCS'}</td>
                    <td>{w.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>الإجمالي</td>
                  <td data-numeric>{wasteTotal.toLocaleString('en-US')}</td>
                  <td colSpan={2}>—</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </section>

      {/* ─── 3) رصيد المخزون (بعد الترحيل) ──────────── */}
      {balance && (
        <section className="block">
          <h2>3) رصيد المخزون الحالي</h2>
          <div className="two-col">
            <div>
              <strong style={{ fontSize: 11 }}>🥛 الحليب الخام</strong>
              {(balance.milk ?? []).length === 0 ? (
                <div className="empty" style={{ marginTop: 4 }}>—</div>
              ) : (
                <table className="report-table" style={{ marginTop: 4 }}>
                  <thead>
                    <tr>
                      <th>الصنف</th>
                      <th style={{ width: '40%' }}>الرصيد</th>
                    </tr>
                  </thead>
                  <tbody>
                    {balance.milk.map((b: any) => (
                      <tr key={b.id}>
                        <td style={{ fontSize: 11 }}>{b.name}</td>
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
              <strong style={{ fontSize: 11 }}>📦 الكرتون + الألمنيوم</strong>
              {[...(balance.carton ?? []), ...(balance.aluminum ?? [])].length === 0 ? (
                <div className="empty" style={{ marginTop: 4 }}>—</div>
              ) : (
                <table className="report-table" style={{ marginTop: 4 }}>
                  <thead>
                    <tr>
                      <th>الصنف</th>
                      <th style={{ width: '40%' }}>الرصيد</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...(balance.carton ?? []), ...(balance.aluminum ?? [])].map((b: any) => (
                      <tr key={b.id}>
                        <td style={{ fontSize: 11 }}>{b.name}</td>
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

      {/* ─── الملاحظات ────────────────────────────────── */}
      {data.notes && (
        <section className="block">
          <h2>📝 ملاحظات</h2>
          <div
            style={{
              fontSize: 12,
              lineHeight: 1.7,
              background: '#fafafa',
              padding: 10,
              borderRadius: 4,
              border: '1px solid #e4e4e7',
              whiteSpace: 'pre-wrap',
            }}
          >
            {data.notes}
          </div>
        </section>
      )}

      {/* ─── التوقيعات ────────────────────────────────── */}
      <div className="signatures">
        <div className="sig-box">
          <div className="role">المشغّل</div>
          <div className="line">
            الاسم: {data.operatorName || '____________'}
            <br />
            التوقيع: ____________
          </div>
        </div>
        <div className="sig-box">
          <div className="role">رئيس الإنتاج</div>
          <div className="line">
            الاسم: ____________
            <br />
            التوقيع: ____________
          </div>
        </div>
        <div className="sig-box">
          <div className="role">المدير</div>
          <div className="line">
            الاسم: ____________
            <br />
            التوقيع: ____________
          </div>
        </div>
      </div>

      <div className="footer-note">
        نظام Enjoy Milk ERP · مصنع الدانا لمنتجات الحليب واللبن · طُبع في{' '}
        {new Date().toLocaleString('ar-EG')}
      </div>
    </div>
  );
}
