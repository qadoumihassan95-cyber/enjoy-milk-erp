'use client';

/**
 * Shared invoice form used by /invoices/new and /invoices/[id].
 *
 * Persistence: hits the backend via api client.
 *   - POST /invoices        (create)
 *   - PATCH /invoices/:id   (update)
 *   - GET /invoices/next-number  (suggested invoice number for new)
 *
 * Layout mirrors the factory's real invoice reference PDF —
 * NO values from the PDF are hardcoded; every field starts empty.
 * Print + PDF via the browser's native print engine (real structured
 * output with selectable Arabic text, RTL correct).
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Printer, FileText, Save, ArrowRight } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { api } from '@/lib/api';
import { useToast } from '@/components/toast';
import { FACTORY_NAME, FACTORY_SUB } from '@/lib/branding';
import { extractApiMessage } from '@/lib/api-errors';
import { sanitizeNumericInput, blurOnWheel } from '@/lib/numeric';

type PaymentMethod = 'cash' | 'check' | 'debit' | '';

export interface LineItem {
  qty: number;
  description: string;
  unitPrice: number;
}

export interface InvoiceFormValue {
  id?: string;
  invoiceNumber: string;
  invoiceDate: string;
  status?: 'DRAFT' | 'ISSUED' | 'CANCELLED';
  customer: {
    id?: string | null;
    name: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    phone: string;
  };
  lines: LineItem[];
  discount: number;
  paymentMethod: PaymentMethod;
  paymentReference: string;
  currency: string;
  origin: string;
  notes: string;
}

const EMPTY: InvoiceFormValue = {
  invoiceNumber: '',
  invoiceDate: new Date().toISOString().slice(0, 10),
  status: 'DRAFT',
  customer: { id: null, name: '', address: '', city: '', state: '', zip: '', phone: '' },
  lines: [{ qty: 0, description: '', unitPrice: 0 }],
  discount: 0,
  paymentMethod: '',
  paymentReference: '',
  currency: '$',
  origin: '',
  notes: '',
};

/** Convert API record → form value. */
export function fromApi(row: any): InvoiceFormValue {
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber ?? '',
    invoiceDate: (row.invoiceDate ?? '').toString().slice(0, 10) || EMPTY.invoiceDate,
    status: row.status ?? 'DRAFT',
    customer: {
      id: row.customerId ?? null,
      name: row.customerName ?? '',
      address: row.customerAddress ?? '',
      city: row.customerCity ?? '',
      state: row.customerState ?? '',
      zip: row.customerZip ?? '',
      phone: row.customerPhone ?? '',
    },
    lines: Array.isArray(row.lines) && row.lines.length
      ? row.lines.map((l: any) => ({
          qty: Number(l.qty ?? 0),
          description: l.description ?? '',
          unitPrice: Number(l.unitPrice ?? 0),
        }))
      : [{ qty: 0, description: '', unitPrice: 0 }],
    discount: Number(row.discount ?? 0),
    paymentMethod: (row.paymentMethod ?? '') as PaymentMethod,
    paymentReference: row.paymentReference ?? '',
    currency: row.currency ?? '$',
    origin: row.origin ?? '',
    notes: row.notes ?? '',
  };
}

/** Convert form value → API payload. */
function toPayload(v: InvoiceFormValue) {
  return {
    invoiceNumber: v.invoiceNumber,
    invoiceDate: v.invoiceDate,
    status: v.status,
    customerId: v.customer.id,
    customerName: v.customer.name,
    customerAddress: v.customer.address,
    customerCity: v.customer.city,
    customerState: v.customer.state,
    customerZip: v.customer.zip,
    customerPhone: v.customer.phone,
    currency: v.currency,
    discount: v.discount,
    paymentMethod: v.paymentMethod || null,
    paymentReference: v.paymentReference,
    origin: v.origin,
    notes: v.notes,
    lines: v.lines.map((l) => ({
      qty: l.qty,
      description: l.description,
      unitPrice: l.unitPrice,
    })),
  };
}

export function InvoiceForm({
  initial,
  mode,
}: {
  initial?: InvoiceFormValue;
  mode: 'create' | 'edit';
}) {
  const router = useRouter();
  const toast = useToast();
  const [inv, setInv] = useState<InvoiceFormValue>(initial ?? EMPTY);
  const [saving, setSaving] = useState(false);

  // On create: fetch a suggested invoice number if the field is empty
  useEffect(() => {
    if (mode !== 'create' || inv.invoiceNumber) return;
    let cancelled = false;
    api.get('/invoices/next-number').then((r) => {
      if (!cancelled && r?.data?.suggested) {
        setInv((p) => (p.invoiceNumber ? p : { ...p, invoiceNumber: r.data.suggested }));
      }
    }).catch(() => { /* offline / cold start — user can type manually */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Restore document title on unmount so print title doesn't leak
  useEffect(() => {
    const original = typeof document !== 'undefined' ? document.title : '';
    return () => { if (typeof document !== 'undefined') document.title = original; };
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

  const setC = (patch: Partial<InvoiceFormValue['customer']>) =>
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

  const save = async (): Promise<{ id: string } | null> => {
    if (!inv.invoiceNumber.trim()) {
      toast.error('الرجاء إدخال رقم الفاتورة');
      return null;
    }
    if (!inv.customer.name.trim()) {
      toast.error('الرجاء إدخال اسم الزبون');
      return null;
    }
    setSaving(true);
    try {
      const payload = toPayload(inv);
      let res;
      if (mode === 'edit' && inv.id) {
        res = await api.patch(`/invoices/${inv.id}`, payload);
      } else {
        res = await api.post('/invoices', payload);
      }
      toast.success('تم حفظ الفاتورة');
      if (mode === 'create' && res?.data?.id) {
        // Move to edit route so subsequent saves update in place
        router.replace(`/invoices/${res.data.id}`);
      }
      return { id: res.data.id };
    } catch (e: any) {
      const msg = extractApiMessage(e) || 'تعذر حفظ الفاتورة';
      toast.error(String(msg));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const printOrPdf = async (kind: 'print' | 'pdf') => {
    const r = await save();
    if (!r) return;
    document.title =
      kind === 'pdf'
        ? `invoice-${(inv.invoiceNumber || 'draft').replace(/[^\w-]+/g, '-')}-${inv.invoiceDate}`
        : `Invoice-${inv.invoiceNumber || 'draft'}-${inv.invoiceDate}`;
    setTimeout(() => window.print(), 80);
  };

  const fmtMoney = (n: number) =>
    `${inv.currency}${n.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto p-3 md:p-6 space-y-4" dir="rtl" data-invoice-root>
        {/* Toolbar */}
        <header className="no-print flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/invoices')}
              className="text-zinc-500 hover:text-zinc-900"
              title="رجوع للقائمة"
            >
              <ArrowRight className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-2xl md:text-3xl font-black tracking-tight">
                {mode === 'edit' ? 'تعديل فاتورة' : 'فاتورة جديدة'}
              </h1>
              <p className="text-sm text-zinc-500 mt-0.5">
                نموذج قابل للتعبئة والحفظ والطباعة و تصدير PDF
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1.5 h-10 px-3 rounded-lg border border-zinc-200 bg-white text-sm font-bold hover:bg-zinc-50 disabled:opacity-50"
            >
              <Save className="h-4 w-4" /> حفظ
            </button>
            <button
              type="button"
              onClick={() => printOrPdf('print')}
              disabled={saving}
              className="inline-flex items-center gap-1.5 h-10 px-3 rounded-lg border border-zinc-200 bg-white text-sm font-bold hover:bg-zinc-50 disabled:opacity-50"
            >
              <Printer className="h-4 w-4" /> طباعة
            </button>
            <button
              type="button"
              onClick={() => printOrPdf('pdf')}
              disabled={saving}
              className="inline-flex items-center gap-1.5 h-10 px-3 rounded-lg bg-zinc-900 text-white text-sm font-bold hover:bg-zinc-800 disabled:opacity-50"
            >
              <FileText className="h-4 w-4" /> PDF
            </button>
          </div>
        </header>

        {/* Paper */}
        <div className="invoice-paper bg-white shadow-sm border border-zinc-200 rounded-md p-4 md:p-8 space-y-4">
          {/* Header band */}
          <div className="invoice-header flex items-start justify-between gap-4 border-b-2 border-blue-700 pb-3">
            <div>
              <div className="text-lg md:text-xl font-black">{FACTORY_NAME}</div>
              <div className="text-xs text-zinc-500 mt-0.5">{FACTORY_SUB}</div>
              <div className="text-[11px] text-zinc-500 mt-1">
                Zarka Free Zone, Jordan · 5047 Amman 11183
              </div>
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

          {/* Title + Date */}
          <div className="flex items-center justify-between gap-4">
            <div className="italic font-black text-2xl md:text-4xl text-blue-800 rounded-lg border-2 border-blue-700 px-4 md:px-6 py-1">
              فاتورة
            </div>
            <div className="flex items-center gap-2 rounded-lg border-2 border-blue-700 px-3 py-2">
              <label className="text-xs font-bold text-zinc-600">Date</label>
              <input
                type="date"
                value={inv.invoiceDate}
                onChange={(e) => setInv({ ...inv, invoiceDate: e.target.value })}
                className="text-sm border-0 focus:ring-0 no-print-border"
                dir="ltr"
              />
            </div>
          </div>

          {/* Customer */}
          <div>
            <div className="text-sm font-bold mb-1">اسم الزبون</div>
            <div className="rounded-lg border border-zinc-300 p-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              <LabeledInput label="الاسم" value={inv.customer.name} onChange={(v) => setC({ name: v })} />
              <LabeledInput label="العنوان" value={inv.customer.address} onChange={(v) => setC({ address: v })} />
              <LabeledInput label="المدينة" value={inv.customer.city} onChange={(v) => setC({ city: v })} />
              <LabeledInput label="المحافظة" value={inv.customer.state} onChange={(v) => setC({ state: v })} />
              <LabeledInput label="ZIP" value={inv.customer.zip} onChange={(v) => setC({ zip: v })} />
              <LabeledInput label="الهاتف" value={inv.customer.phone} onChange={(v) => setC({ phone: v })} />
            </div>
          </div>

          {/* Line-item table */}
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="invoice-lines w-full border border-zinc-300 border-collapse text-sm min-w-[520px]">
              <thead>
                <tr className="bg-blue-50 text-zinc-700">
                  <th className="border border-zinc-300 px-2 py-1.5 w-20">الكمية</th>
                  <th className="border border-zinc-300 px-2 py-1.5">الوصف</th>
                  <th className="border border-zinc-300 px-2 py-1.5 w-24">سعر الوحدة</th>
                  <th className="border border-zinc-300 px-2 py-1.5 w-28">المجموع</th>
                  <th className="border border-zinc-300 px-2 py-1.5 w-10 no-print"></th>
                </tr>
              </thead>
              <tbody>
                {inv.lines.map((l, i) => {
                  const total = Number(l.qty || 0) * Number(l.unitPrice || 0);
                  return (
                    <tr key={i}>
                      <td className="border border-zinc-300 p-1">
                        <input
                          type="text"
                  inputMode="decimal"
                  dir="ltr"
                          value={l.qty || ''}
                          onChange={(e) => setLine(i, { qty: +sanitizeNumericInput(e.target.value, { allowDecimal: true }) })} className="w-full text-center border-0 focus:ring-0 no-print-border"
                        onWheel={blurOnWheel}
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
                          type="text"
                  inputMode="decimal"
                  dir="ltr"
                          value={l.unitPrice || ''}
                          onChange={(e) => setLine(i, { unitPrice: +sanitizeNumericInput(e.target.value, { allowDecimal: true }) })} className="w-full text-center border-0 focus:ring-0 no-print-border"
                        onWheel={blurOnWheel}
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
          </div>
          <div className="no-print">
            <button
              type="button"
              onClick={addLine}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-dashed border-zinc-300 text-sm text-zinc-600 hover:bg-zinc-50"
            >
              <Plus className="h-4 w-4" /> إضافة سطر
            </button>
          </div>

          {/* Origin */}
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

          {/* Payment + Totals */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-lg border border-zinc-300 p-3 text-sm">
              <div className="font-bold mb-2">Payment Details</div>
              <div className="flex items-center gap-4 flex-wrap">
                {(['cash', 'check', 'debit'] as PaymentMethod[]).map((m) => (
                  <label key={m as string} className="flex items-center gap-1.5 cursor-pointer">
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

            <div className="rounded-lg border border-zinc-300 p-3 text-sm space-y-1.5" dir="ltr">
              <TotalRow label="SubTotal" value={fmtMoney(totals.subTotal)} />
              <div className="flex items-center justify-between">
                <span className="text-zinc-600">Discount</span>
                <input
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  value={inv.discount || ''}
                  onChange={(e) => setInv({ ...inv, discount: +sanitizeNumericInput(e.target.value, { allowDecimal: true }) })} className="w-28 text-right border border-zinc-200 rounded px-2 py-0.5 no-print-border"
                onWheel={blurOnWheel}
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

          <div className="border-t-2 border-blue-700 mt-4" />
          <div className="text-[10px] text-zinc-400 text-center print-only">
            {FACTORY_NAME} · {FACTORY_SUB}
          </div>
        </div>
      </div>

      <style jsx global>{`
        .print-only { display: none; }
        @media print {
          @page { size: A4 portrait; margin: 10mm 10mm; }
          html, body { background: #fff !important; }
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
          .invoice-paper input, .invoice-paper .no-print-border {
            border: none !important;
            background: transparent !important;
            padding: 0 2px !important;
            color: #000 !important;
            -webkit-appearance: none; appearance: none;
          }
          .invoice-paper input[type="date"]::-webkit-calendar-picker-indicator { display: none; }
          .invoice-lines th, .invoice-lines td { border: 1pt solid #333 !important; }
          .print-only { display: block !important; }
        }
      `}</style>
    </AppShell>
  );
}

function LabeledInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-zinc-500 min-w-[80px]">{label}:</span>
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
