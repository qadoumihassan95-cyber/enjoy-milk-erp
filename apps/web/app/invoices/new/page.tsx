'use client';

/**
 * OFFICIAL INVOICE TEMPLATE (editable + printable + PDF).
 *
 * Layout mirrors the factory's real invoice PDF ("034\2026 فاتوره العربيه"):
 *   ▸ Header band  — logo/name (right), invoice number top-right
 *   ▸ Title band   — "فاتورة" + Date box
 *   ▸ Customer box — Name / Address / City / State / ZIP / Phone
 *   ▸ Line table   — Qty (كرتونة) | Description | Unit Price | Total
 *   ▸ Totals block — SubTotal / Discount / TOTAL
 *   ▸ Payment box  — Cash / Check / Debit + reference lines
 *   ▸ Footer rule
 *
 * NO PDF numbers are hardcoded — every field starts blank / calculated.
 * Users fill, save (draft to localStorage), print (browser dialog) or
 * export PDF (same print engine — Chrome "Save as PDF" produces a real
 * structured PDF, selectable Arabic text, RTL correct, not a bitmap).
 *
 * localStorage draft keyed per invoice-number so users don't lose input
 * on reload.
 */

import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Printer, FileText, Save } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { FACTORY_NAME, FACTORY_SUB } from '@/lib/branding';

type PaymentMethod = 'cash' | 'check' | 'debit';

interface LineItem {
  qty: number;
  description: string;
  unitPrice: number;
}

interface InvoiceDraft {
  invoiceNumber: string;
  date: string;                 // YYYY-MM-DD
  customer: {
    name: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    phone: string;
  };
  lines: LineItem[];
  discount: number;
  paymentMethod: PaymentMethod | '';
  paymentReference: string;
  currency: string;             // '$' or 'د.أ' etc.
  origin: string;               // e.g. "New Zealand" — free text under description
  notes: string;
}

const EMPTY: InvoiceDraft = {
  invoiceNumber: '',
  date: new Date().toISOString().slice(0, 10),
  customer: { name: '', address: '', city: '', state: '', zip: '', phone: '' },
  lines: [{ qty: 0, description: '', unitPrice: 0 }],
  discount: 0,
  paymentMethod: '',
  paymentReference: '',
  currency: '$',
  origin: '',
  notes: '',
};

const DRAFT_KEY_PREFIX = 'invoice-draft:';

export default function NewInvoicePage() {
  const [inv, setInv] = useState<InvoiceDraft>(EMPTY);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Load draft if invoice number was previously saved
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      // Try the last-used draft on first mount
      const last = localStorage.getItem('invoice-draft:__last__');
      if (last) {
        const parsed = JSON.parse(last);
        if (parsed && typeof parsed === 'object') setInv({ ...EMPTY, ...parsed });
      }
    } catch { /* ignore */ }
  }, []);

  // Restore document title on unmount so back-nav doesn't leave "invoice-…"
  useEffect(() => {
    const original = typeof document !== 'undefined' ? document.title : '';
    return () => {
      if (typeof document !== 'undefined') document.title = original;
    };
  }, []);

  const totals = useMemo(() => {
    const subTotal = inv.lines.reduce(
      (s, l) => s + Number(l.qty || 0) * Number(l.unitPrice || 0),
      0,
    );
    const discount = Number(inv.discount || 0);
    const total = Math.max(0, subTotal - discount);
    return { subTotal, discount, total };
  }, [inv.lines, inv.discount]);

  const setC = (patch: Partial<InvoiceDraft['customer']>) =>
    setInv({ ...inv, customer: { ...inv.customer, ...patch } });

  const setLine = (i: number, patch: Partial<LineItem>) => {
    const lines = [...inv.lines];
    lines[i] = { ...lines[i], ...patch };
    setInv({ ...inv, lines });
  };
  const addLine = () =>
    setInv({ ...inv, lines: [...inv.lines, { qty: 0, description: '', unitPrice: 0 }] });
  const removeLine = (i: number) =>
    setInv({ ...inv, lines: inv.lines.filter((_, idx) => idx !== i) });

  const saveDraft = () => {
    if (typeof window === 'undefined') return;
    try {
      const key = inv.invoiceNumber
        ? DRAFT_KEY_PREFIX + inv.invoiceNumber
        : DRAFT_KEY_PREFIX + '__last__';
      localStorage.setItem(key, JSON.stringify(inv));
      localStorage.setItem(DRAFT_KEY_PREFIX + '__last__', JSON.stringify(inv));
      setSavedAt(new Date().toLocaleTimeString('ar-JO'));
    } catch { /* ignore quota / private mode */ }
  };

  const doPrint = () => {
    saveDraft();
    document.title = `Invoice-${inv.invoiceNumber || 'draft'}-${inv.date}`;
    setTimeout(() => window.print(), 50);
  };
  const doPdf = () => {
    saveDraft();
    // Chrome uses document.title as the default "Save as PDF" filename.
    document.title = `invoice-${(inv.invoiceNumber || 'draft').replace(/[^\w-]+/g, '-')}-${inv.date}`;
    setTimeout(() => window.print(), 50);
  };

  const fmtMoney = (n: number) =>
    `${inv.currency}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto p-3 md:p-6 space-y-4" dir="rtl" data-invoice-root>
        {/* ─── SCREEN-ONLY TOOLBAR ─────────────────────────────── */}
        <header className="no-print flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight">فاتورة رسمية</h1>
            <p className="text-sm text-zinc-500 mt-0.5">
              نموذج قابل للتعبئة والطباعة و تصدير PDF
              {savedAt && <span className="ms-3 text-emerald-600">✓ حُفظت في {savedAt}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={saveDraft}
              className="inline-flex items-center gap-1.5 h-10 px-3 rounded-lg border border-zinc-200 bg-white text-sm font-bold hover:bg-zinc-50 active:scale-[0.98]"
            >
              <Save className="h-4 w-4" /> حفظ مسودة
            </button>
            <button
              type="button"
              onClick={doPrint}
              className="inline-flex items-center gap-1.5 h-10 px-3 rounded-lg border border-zinc-200 bg-white text-sm font-bold hover:bg-zinc-50 active:scale-[0.98]"
            >
              <Printer className="h-4 w-4" /> طباعة
            </button>
            <button
              type="button"
              onClick={doPdf}
              className="inline-flex items-center gap-1.5 h-10 px-3 rounded-lg bg-zinc-900 text-white text-sm font-bold hover:bg-zinc-800 active:scale-[0.98]"
            >
              <FileText className="h-4 w-4" /> PDF
            </button>
          </div>
        </header>

        {/* ─── INVOICE PAPER ─────────────────────────────────────── */}
        <div className="invoice-paper bg-white shadow-sm border border-zinc-200 rounded-md p-5 md:p-8 space-y-4">
          {/* Header band */}
          <div className="invoice-header flex items-start justify-between gap-4 border-b-2 border-blue-700 pb-3">
            <div>
              <div className="text-lg md:text-xl font-black">{FACTORY_NAME}</div>
              <div className="text-xs text-zinc-500 mt-0.5">{FACTORY_SUB}</div>
              <div className="text-[11px] text-zinc-500 mt-1">Zarka Free Zone, Jordan · 5047 Amman 11183</div>
            </div>
            <div className="text-left" dir="ltr">
              <div className="text-[11px] text-zinc-500">Invoice No.</div>
              <input
                type="text"
                value={inv.invoiceNumber}
                onChange={(e) => setInv({ ...inv, invoiceNumber: e.target.value })}
                placeholder="000\\2026"
                className="w-28 text-left font-black text-base border border-zinc-200 rounded px-2 py-1 no-print-border"
              />
            </div>
          </div>

          {/* Title + Date band */}
          <div className="flex items-center justify-between gap-4">
            <div className="italic font-black text-3xl md:text-4xl text-blue-800 rounded-lg border-2 border-blue-700 px-6 py-1">
              فاتورة
            </div>
            <div className="flex items-center gap-2 rounded-lg border-2 border-blue-700 px-3 py-2">
              <label className="text-xs font-bold text-zinc-600">Date</label>
              <input
                type="date"
                value={inv.date}
                onChange={(e) => setInv({ ...inv, date: e.target.value })}
                className="text-sm border-0 focus:ring-0 no-print-border"
                dir="ltr"
              />
            </div>
          </div>

          {/* Customer block */}
          <div>
            <div className="text-sm font-bold mb-1">اسم الزبون</div>
            <div className="rounded-lg border border-zinc-300 p-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              <LabeledInput label="الاسم / Name" value={inv.customer.name} onChange={(v) => setC({ name: v })} />
              <LabeledInput label="العنوان / Address" value={inv.customer.address} onChange={(v) => setC({ address: v })} />
              <LabeledInput label="المدينة / City" value={inv.customer.city} onChange={(v) => setC({ city: v })} />
              <LabeledInput label="المحافظة / State" value={inv.customer.state} onChange={(v) => setC({ state: v })} />
              <LabeledInput label="ZIP" value={inv.customer.zip} onChange={(v) => setC({ zip: v })} />
              <LabeledInput label="الهاتف / Phone" value={inv.customer.phone} onChange={(v) => setC({ phone: v })} />
            </div>
          </div>

          {/* Line-item table */}
          <div>
            <table className="invoice-lines w-full border border-zinc-300 border-collapse text-sm">
              <thead>
                <tr className="bg-blue-50 text-zinc-700">
                  <th className="border border-zinc-300 px-2 py-1.5 w-24">الكمية / كرتونة</th>
                  <th className="border border-zinc-300 px-2 py-1.5">الوصف</th>
                  <th className="border border-zinc-300 px-2 py-1.5 w-28">سعر الوحدة</th>
                  <th className="border border-zinc-300 px-2 py-1.5 w-32">المجموع</th>
                  <th className="border border-zinc-300 px-2 py-1.5 w-12 no-print"></th>
                </tr>
              </thead>
              <tbody>
                {inv.lines.map((l, i) => {
                  const total = Number(l.qty || 0) * Number(l.unitPrice || 0);
                  return (
                    <tr key={i}>
                      <td className="border border-zinc-300 p-1">
                        <input
                          type="number"
                          step="0.01"
                          value={l.qty || ''}
                          onChange={(e) => setLine(i, { qty: +e.target.value })}
                          className="w-full text-center border-0 focus:ring-0 no-print-border"
                        />
                      </td>
                      <td className="border border-zinc-300 p-1">
                        <input
                          type="text"
                          value={l.description}
                          onChange={(e) => setLine(i, { description: e.target.value })}
                          className="w-full border-0 focus:ring-0 no-print-border"
                          placeholder="اسم المنتج"
                        />
                      </td>
                      <td className="border border-zinc-300 p-1">
                        <input
                          type="number"
                          step="0.01"
                          value={l.unitPrice || ''}
                          onChange={(e) => setLine(i, { unitPrice: +e.target.value })}
                          className="w-full text-center border-0 focus:ring-0 no-print-border"
                          dir="ltr"
                        />
                      </td>
                      <td className="border border-zinc-300 p-1 text-center font-bold" dir="ltr">
                        {fmtMoney(total)}
                      </td>
                      <td className="border border-zinc-300 p-1 text-center no-print">
                        {inv.lines.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeLine(i)}
                            className="text-red-600 hover:text-red-800"
                            aria-label="حذف السطر"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-2 no-print">
              <button
                type="button"
                onClick={addLine}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-dashed border-zinc-300 text-sm text-zinc-600 hover:bg-zinc-50"
              >
                <Plus className="h-4 w-4" /> إضافة سطر
              </button>
            </div>
          </div>

          {/* Origin (free text below the line table) */}
          <div className="text-xs text-zinc-600">
            <label className="font-bold">Origin: </label>
            <input
              type="text"
              value={inv.origin}
              onChange={(e) => setInv({ ...inv, origin: e.target.value })}
              className="border-b border-zinc-300 focus:outline-none focus:border-blue-500 px-1 min-w-[120px]"
              placeholder="—"
            />
          </div>

          {/* Payment + Totals row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Payment block (left) */}
            <div className="rounded-lg border border-zinc-300 p-3 text-sm">
              <div className="font-bold mb-2">Payment Details</div>
              <div className="flex items-center gap-4 flex-wrap">
                {(['cash', 'check', 'debit'] as PaymentMethod[]).map((m) => (
                  <label key={m} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="paymentMethod"
                      checked={inv.paymentMethod === m}
                      onChange={() => setInv({ ...inv, paymentMethod: m })}
                    />
                    <span className="capitalize">{m}</span>
                  </label>
                ))}
              </div>
              <input
                type="text"
                value={inv.paymentReference}
                onChange={(e) => setInv({ ...inv, paymentReference: e.target.value })}
                placeholder="رقم الشيك / المرجع"
                className="w-full mt-3 border-b border-zinc-300 focus:outline-none focus:border-blue-500 pb-0.5 text-sm"
              />
            </div>

            {/* Totals block (right) */}
            <div className="rounded-lg border border-zinc-300 p-3 text-sm space-y-1.5" dir="ltr">
              <TotalRow label="SubTotal" value={fmtMoney(totals.subTotal)} />
              <div className="flex items-center justify-between">
                <span className="text-zinc-600">Discount</span>
                <input
                  type="number"
                  step="0.01"
                  value={inv.discount || ''}
                  onChange={(e) => setInv({ ...inv, discount: +e.target.value })}
                  className="w-28 text-right border border-zinc-200 rounded px-2 py-0.5 no-print-border"
                />
              </div>
              <div className="h-px bg-zinc-300 my-1" />
              <TotalRow label="TOTAL" value={fmtMoney(totals.total)} bold />
              <div className="text-[10px] text-zinc-400 text-right no-print">
                العملة:
                <input
                  type="text"
                  value={inv.currency}
                  onChange={(e) => setInv({ ...inv, currency: e.target.value })}
                  className="ms-1 w-12 text-center border-b border-zinc-200 focus:outline-none"
                  maxLength={3}
                />
              </div>
            </div>
          </div>

          {/* Notes (screen + print, tiny) */}
          {(inv.notes || true) && (
            <div className="text-xs text-zinc-600">
              <label className="font-bold">ملاحظات: </label>
              <input
                type="text"
                value={inv.notes}
                onChange={(e) => setInv({ ...inv, notes: e.target.value })}
                className="border-b border-zinc-300 focus:outline-none focus:border-blue-500 px-1 w-full max-w-md"
                placeholder="—"
              />
            </div>
          )}

          {/* Footer rule */}
          <div className="border-t-2 border-blue-700 mt-4" />
          <div className="text-[10px] text-zinc-400 text-center print-only">
            {FACTORY_NAME} · {FACTORY_SUB}
          </div>
        </div>
      </div>

      {/* ─── PRINT STYLES ─────────────────────────────────────── */}
      <style jsx global>{`
        .print-only { display: none; }
        @media print {
          @page { size: A4 portrait; margin: 10mm 10mm; }
          html, body { background: #fff !important; }

          /* Hide app chrome */
          nav, aside, header:not(.invoice-header),
          .no-print, [data-navigation], [data-app-shell-sidebar],
          [data-app-shell-header], [data-mobile-nav], [data-hide-in-print] {
            display: none !important;
          }
          body [data-app-shell-root],
          body [data-app-shell-main] {
            padding: 0 !important; margin: 0 !important; background: #fff !important;
          }
          [data-invoice-root] {
            max-width: none !important;
            padding: 0 !important;
            margin: 0 !important;
            direction: rtl !important;
          }
          .invoice-paper {
            box-shadow: none !important;
            border: none !important;
            border-radius: 0 !important;
            padding: 0 !important;
          }
          /* Neutralize input styling in print so values look like plain text */
          .invoice-paper input, .invoice-paper .no-print-border {
            border: none !important;
            background: transparent !important;
            padding: 0 2px !important;
            color: #000 !important;
            -webkit-appearance: none;
            appearance: none;
          }
          .invoice-paper input[type="date"]::-webkit-calendar-picker-indicator { display: none; }
          .invoice-lines th, .invoice-lines td { border: 1pt solid #333 !important; }
          .print-only { display: block !important; }
        }
      `}</style>
    </AppShell>
  );
}

function LabeledInput({
  label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-zinc-500 min-w-[110px]">{label}:</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 border-b border-zinc-200 focus:outline-none focus:border-blue-500 py-0.5 text-sm no-print-border"
      />
    </div>
  );
}

function TotalRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${bold ? 'text-base font-black' : ''}`}>
      <span className={bold ? 'text-zinc-900' : 'text-zinc-600'}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
