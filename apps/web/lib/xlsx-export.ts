/**
 * Enjoy Milk ERP — Shared Excel export design system.
 *
 * Central builder that every export site in the app uses. Produces
 * enterprise-grade .xlsx workbooks (not CSV) with a consistent look:
 *   - Cover sheet: brand + title + generation timestamp + user + filters
 *   - KPI summary sheet: 5–8 headline metrics
 *   - Details sheet: main grid with frozen header, auto-filter, auto-widths
 *   - Optional charts / pivot / raw-data sheets per report
 *
 * ExcelJS is imported dynamically the first time buildWorkbook() runs, so
 * the library (~500KB) never lands in the initial page bundle.
 *
 * Do NOT put any business logic here — this module is presentation only.
 * Callers pass already-computed rows and totals; this module makes them
 * look like something an accountant at SAP would ship.
 */

import { FACTORY_NAME } from './branding';

export type CellValue = string | number | Date | null | undefined;

export type CurrencyCode = 'JOD' | 'USD';

/** Column definition passed by every caller. */
export interface XlsxColumn {
  key: string;                    // property name on each row
  header: string;                  // header label (Arabic OK)
  width?: number;                  // characters; auto if omitted
  align?: 'left' | 'right' | 'center';
  format?:
    | 'text'
    | 'integer'
    | 'decimal2'
    | 'decimal3'
    | 'percent'
    | 'date'
    | 'datetime'
    | 'jod'
    | 'usd'
    | string;
  /** Tint the whole column header + cells (soft) — used to group columns visually. */
  tint?: 'blue' | 'green' | 'orange' | 'cyan' | 'yellow' | 'gray';
  /** If true, this column is bold in each row. */
  strong?: boolean;
}

/** One KPI tile on the summary sheet. */
export interface XlsxKpi {
  label: string;
  value: CellValue;
  format?: XlsxColumn['format'];
  tint?: XlsxColumn['tint'];
}

/** Conditional-format rule applied to a details column. */
export interface XlsxCondition {
  columnKey: string;
  when: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'contains';
  value: number | string;
  bg?: string;   // ARGB e.g. 'FFFEE2E2'
  fg?: string;   // ARGB
}

/** Filters that were applied at the time of export — printed on the cover. */
export interface XlsxFilterMeta {
  label: string;
  value: string;
}

/** Everything one report passes to the shared builder. */
export interface XlsxWorkbookSpec {
  filename: string;                // e.g. "payroll-2026-07.xlsx"
  reportTitle: string;              // e.g. "كشف الرواتب الرسمي"
  reportTitleEn?: string;
  generatedBy?: string;             // user name/email
  branch?: string;                  // "المصنع الرئيسي"
  filters?: XlsxFilterMeta[];
  currency?: CurrencyCode;          // primary currency for cover metadata
  rtl?: boolean;                     // default true for Arabic reports

  kpis?: XlsxKpi[];

  details: {
    sheetName?: string;              // default "Details"
    columns: XlsxColumn[];
    rows: Record<string, CellValue>[];
    /** Totals row values keyed by column key. */
    totals?: Record<string, CellValue>;
    /** Conditional formatting rules. */
    conditions?: XlsxCondition[];
    /** Row painter for accent rows (0-based index → true to tint). */
    highlightRow?: (row: Record<string, CellValue>, index: number) => boolean;
    /** Extra note printed below the totals row (e.g. company payroll cost). */
    footnote?: string;
  };

  /** Optional signatures block at the bottom of a details sheet. */
  signatures?: string[];
}

/* ═════════════════════════════════════════════
   Palette — matches the on-screen accounting look
════════════════════════════════════════════ */
const PALETTE = {
  brandYellow: 'FFFDE68A',
  brandYellowDark: 'FFCA8A04',
  headerNeutral: 'FFF4F4F5',
  totalCyan: 'FFCFFAFE',
  tints: {
    blue:   { bg: 'FFEFF6FF', fg: 'FF1E3A8A' },
    green:  { bg: 'FFECFDF5', fg: 'FF065F46' },
    orange: { bg: 'FFFFF7ED', fg: 'FF9A3412' },
    cyan:   { bg: 'FFECFEFF', fg: 'FF155E75' },
    yellow: { bg: 'FFFEFCE8', fg: 'FF854D0E' },
    gray:   { bg: 'FFF4F4F5', fg: 'FF3F3F46' },
  },
} as const;

/* ═════════════════════════════════════════════
   Number format map
════════════════════════════════════════════ */
function numberFormat(fmt?: XlsxColumn['format']): string | undefined {
  switch (fmt) {
    case 'integer':  return '#,##0';
    case 'decimal2': return '#,##0.00';
    case 'decimal3': return '#,##0.000';
    case 'percent':  return '0.00%';
    case 'date':     return 'yyyy-mm-dd';
    case 'datetime': return 'yyyy-mm-dd hh:mm';
    case 'jod':      return '#,##0.000 " د.أ"';
    case 'usd':      return '"$"#,##0.00';
    default:         return fmt; // custom Excel format string passthrough
  }
}

/* ═════════════════════════════════════════════
   Column width auto-sizing (ch based on longest cell)
════════════════════════════════════════════ */
function computeWidth(col: XlsxColumn, rows: Record<string, CellValue>[]): number {
  if (col.width) return col.width;
  const headerLen = String(col.header ?? '').length;
  let max = headerLen;
  for (const r of rows) {
    const v = r[col.key];
    const s = v == null ? '' : String(v);
    if (s.length > max) max = s.length;
    if (max > 40) return 40;
  }
  return Math.max(10, Math.min(40, max + 2));
}

/* ═════════════════════════════════════════════
   The builder
════════════════════════════════════════════ */
export async function buildWorkbook(spec: XlsxWorkbookSpec): Promise<Blob> {
  // Lazy-load ExcelJS so the ~500KB library only ships when someone actually
  // clicks "Export Excel" — not on every page load.
  const ExcelJS = (await import('exceljs')).default ?? (await import('exceljs'));
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Enjoy Milk ERP';
  wb.company = FACTORY_NAME;
  wb.created = new Date();
  wb.modified = new Date();

  const rtl = spec.rtl !== false;
  const now = new Date();
  const nowLabel = now.toLocaleString(rtl ? 'ar-JO' : 'en-US');

  /* ── Sheet 1: Cover ── */
  const cover = wb.addWorksheet('التقرير · Cover', {
    views: [{ state: 'frozen', ySplit: 0, rightToLeft: rtl }],
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true },
  });
  cover.columns = [{ width: 34 }, { width: 60 }];

  // Brand band
  cover.mergeCells('A1:B1');
  const brand = cover.getCell('A1');
  brand.value = FACTORY_NAME;
  brand.font = { name: 'Cairo', size: 18, bold: true, color: { argb: 'FF18181B' } };
  brand.alignment = { horizontal: 'center', vertical: 'middle', readingOrder: rtl ? 'rtl' : 'ltr' };
  brand.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALETTE.brandYellow } };
  brand.border = { bottom: { style: 'medium', color: { argb: PALETTE.brandYellowDark } } };
  cover.getRow(1).height = 40;

  // Report title
  cover.mergeCells('A2:B2');
  const title = cover.getCell('A2');
  title.value = spec.reportTitle + (spec.reportTitleEn ? ` · ${spec.reportTitleEn}` : '');
  title.font = { name: 'Cairo', size: 14, bold: true };
  title.alignment = { horizontal: 'center', vertical: 'middle', readingOrder: rtl ? 'rtl' : 'ltr' };
  cover.getRow(2).height = 26;

  // Metadata table
  let coverRow = 4;
  const meta: [string, string][] = [
    ['تاريخ التوليد', nowLabel],
    ['أُعدّ بواسطة', spec.generatedBy ?? 'النظام'],
    ['الفرع', spec.branch ?? 'المصنع الرئيسي'],
    ['العملة الأساسية', spec.currency ?? 'JOD'],
  ];
  for (const [k, v] of meta) {
    const r = cover.getRow(coverRow++);
    r.getCell(1).value = k;
    r.getCell(1).font = { name: 'Cairo', bold: true, color: { argb: 'FF52525B' } };
    r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALETTE.headerNeutral } };
    r.getCell(1).alignment = { horizontal: rtl ? 'right' : 'left', readingOrder: rtl ? 'rtl' : 'ltr' };
    r.getCell(2).value = v;
    r.getCell(2).font = { name: 'Cairo' };
    r.getCell(2).alignment = { horizontal: rtl ? 'right' : 'left', readingOrder: rtl ? 'rtl' : 'ltr' };
    r.height = 20;
  }

  // Filters block
  if (spec.filters && spec.filters.length > 0) {
    coverRow += 1;
    const hdr = cover.getRow(coverRow++);
    hdr.getCell(1).value = 'الفلاتر المطبَّقة';
    hdr.getCell(1).font = { name: 'Cairo', bold: true, size: 12 };
    hdr.getCell(1).alignment = { horizontal: rtl ? 'right' : 'left', readingOrder: rtl ? 'rtl' : 'ltr' };
    cover.mergeCells(`A${coverRow - 1}:B${coverRow - 1}`);
    for (const f of spec.filters) {
      const r = cover.getRow(coverRow++);
      r.getCell(1).value = f.label;
      r.getCell(1).font = { name: 'Cairo', color: { argb: 'FF52525B' } };
      r.getCell(1).alignment = { horizontal: rtl ? 'right' : 'left', readingOrder: rtl ? 'rtl' : 'ltr' };
      r.getCell(2).value = f.value;
      r.getCell(2).font = { name: 'Cairo' };
      r.getCell(2).alignment = { horizontal: rtl ? 'right' : 'left', readingOrder: rtl ? 'rtl' : 'ltr' };
    }
  }

  // Footer note
  coverRow += 2;
  const foot = cover.getRow(coverRow);
  cover.mergeCells(`A${coverRow}:B${coverRow}`);
  foot.getCell(1).value = 'وثيقة رسمية صادرة عن نظام Enjoy Milk ERP.';
  foot.getCell(1).font = { name: 'Cairo', italic: true, color: { argb: 'FF71717A' }, size: 10 };
  foot.getCell(1).alignment = { horizontal: 'center', readingOrder: rtl ? 'rtl' : 'ltr' };

  applyPrintHeader(cover, spec.reportTitle);

  /* ── Sheet 2: KPIs (optional) ── */
  if (spec.kpis && spec.kpis.length > 0) {
    const kpi = wb.addWorksheet('المؤشرات · KPIs', {
      views: [{ state: 'frozen', xSplit: 0, ySplit: 1, rightToLeft: rtl }],
      pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true },
    });
    kpi.columns = [
      { header: 'المؤشر', key: 'label', width: 40 },
      { header: 'القيمة', key: 'value', width: 24 },
    ];
    kpi.getRow(1).eachCell((c) => {
      c.font = { name: 'Cairo', bold: true };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALETTE.brandYellow } };
      c.alignment = { horizontal: 'center', vertical: 'middle', readingOrder: rtl ? 'rtl' : 'ltr' };
      c.border = borderThin();
    });
    kpi.getRow(1).height = 26;
    for (const k of spec.kpis) {
      const row = kpi.addRow({ label: k.label, value: k.value ?? 0 });
      const t = k.tint ? PALETTE.tints[k.tint] : null;
      row.getCell('label').font = { name: 'Cairo', bold: true };
      row.getCell('label').alignment = { horizontal: rtl ? 'right' : 'left', readingOrder: rtl ? 'rtl' : 'ltr' };
      row.getCell('value').font = { name: 'Cairo', bold: true };
      row.getCell('value').numFmt = numberFormat(k.format) ?? '#,##0';
      row.getCell('value').alignment = { horizontal: 'right' };
      if (t) {
        row.getCell('value').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: t.bg } };
        row.getCell('value').font = { name: 'Cairo', bold: true, color: { argb: t.fg } };
      }
      row.eachCell((c) => (c.border = borderThin()));
    }
    applyPrintHeader(kpi, spec.reportTitle);
  }

  /* ── Sheet 3: Details ── */
  const detailsName = spec.details.sheetName ?? 'التفاصيل · Details';
  const details = wb.addWorksheet(detailsName, {
    views: [{ state: 'frozen', ySplit: 1, rightToLeft: rtl }],
    pageSetup: {
      orientation: 'landscape',
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: '1:1',
    },
  });

  // Columns + widths
  details.columns = spec.details.columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: computeWidth(c, spec.details.rows),
    style: {
      numFmt: numberFormat(c.format),
      alignment: {
        horizontal: c.align ?? (['integer', 'decimal2', 'decimal3', 'percent', 'jod', 'usd'].includes(c.format ?? '') ? 'right' : (rtl ? 'right' : 'left')),
        vertical: 'middle',
        readingOrder: rtl ? 'rtl' : 'ltr',
      },
    },
  }));

  // Header row style
  const headerRow = details.getRow(1);
  headerRow.height = 28;
  headerRow.eachCell((cell, colNum) => {
    const col = spec.details.columns[colNum - 1];
    const tint = col?.tint ? PALETTE.tints[col.tint] : null;
    cell.font = { name: 'Cairo', bold: true, color: { argb: tint?.fg ?? 'FF18181B' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tint?.bg ?? PALETTE.brandYellow } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true, readingOrder: rtl ? 'rtl' : 'ltr' };
    cell.border = borderThin();
  });

  // Auto-filter across the header row
  const lastCol = details.columns.length;
  details.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: lastCol },
  };

  // Data rows
  for (let i = 0; i < spec.details.rows.length; i++) {
    const r = spec.details.rows[i];
    const row = details.addRow(r);
    row.height = 20;
    const highlight = spec.details.highlightRow?.(r, i);
    for (let ci = 0; ci < spec.details.columns.length; ci++) {
      const col = spec.details.columns[ci];
      const cell = row.getCell(ci + 1);
      cell.border = borderThin();
      if (col.strong) cell.font = { name: 'Cairo', bold: true };
      const tint = col.tint ? PALETTE.tints[col.tint] : null;
      if (tint && !highlight) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tint.bg } };
      }
      if (highlight) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF9C3' } };
      }
    }
  }

  // Totals row (always present when totals passed)
  if (spec.details.totals) {
    const totalRow = details.addRow(spec.details.totals);
    totalRow.height = 24;
    totalRow.eachCell((cell) => {
      cell.font = { name: 'Cairo', bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALETTE.totalCyan } };
      cell.border = { ...borderThin(), top: { style: 'medium', color: { argb: 'FF18181B' } } };
    });
  }

  // Conditional formatting
  if (spec.details.conditions && spec.details.conditions.length > 0) {
    for (const cond of spec.details.conditions) {
      const colIndex = spec.details.columns.findIndex((c) => c.key === cond.columnKey);
      if (colIndex < 0) continue;
      const colLetter = details.getColumn(colIndex + 1).letter;
      const firstDataRow = 2;
      const lastDataRow = spec.details.rows.length + 1;
      const range = `${colLetter}${firstDataRow}:${colLetter}${lastDataRow}`;
      const opMap: Record<XlsxCondition['when'], string> = {
        gt: 'greaterThan', gte: 'greaterThan', lt: 'lessThan', lte: 'lessThan',
        eq: 'equal', contains: 'containsText',
      };
      details.addConditionalFormatting({
        ref: range,
        rules: [
          {
            type: 'cellIs',
            priority: 1,
            operator: opMap[cond.when] as any,
            formulae: [String(cond.value)],
            style: {
              font: cond.fg ? { color: { argb: cond.fg } } : undefined,
              fill: cond.bg
                ? { type: 'pattern', pattern: 'solid', bgColor: { argb: cond.bg }, fgColor: { argb: cond.bg } }
                : undefined,
            },
          },
        ],
      });
    }
  }

  // Footnote
  if (spec.details.footnote) {
    const footRow = details.addRow([]);
    details.mergeCells(footRow.number, 1, footRow.number, Math.max(3, lastCol));
    const cell = footRow.getCell(1);
    cell.value = spec.details.footnote;
    cell.font = { name: 'Cairo', bold: true, italic: true, color: { argb: 'FF3F3F46' } };
    cell.alignment = { horizontal: rtl ? 'right' : 'left', readingOrder: rtl ? 'rtl' : 'ltr' };
  }

  // Signatures
  if (spec.signatures && spec.signatures.length > 0) {
    details.addRow([]);
    details.addRow([]);
    const sigRow = details.addRow(spec.signatures);
    sigRow.height = 40;
    sigRow.eachCell((cell) => {
      cell.font = { name: 'Cairo', bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'top', readingOrder: rtl ? 'rtl' : 'ltr' };
      cell.border = { top: { style: 'thin', color: { argb: 'FF52525B' } } };
    });
  }

  applyPrintHeader(details, spec.reportTitle);

  /* ── Generate blob ── */
  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** Trigger a download in the browser. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Convenience: build + download in one call. */
export async function exportXlsx(spec: XlsxWorkbookSpec) {
  const blob = await buildWorkbook(spec);
  downloadBlob(blob, spec.filename);
}

/* ─── internal helpers ─── */
function borderThin() {
  const c = { argb: 'FFE4E4E7' };
  return { top: { style: 'thin' as const, color: c }, bottom: { style: 'thin' as const, color: c }, left: { style: 'thin' as const, color: c }, right: { style: 'thin' as const, color: c } };
}

function applyPrintHeader(sheet: any, title: string) {
  sheet.headerFooter = {
    oddHeader: `&L${FACTORY_NAME}&C${title}&R&D`,
    oddFooter: `&Cصفحة &P من &N`,
    evenHeader: `&L${FACTORY_NAME}&C${title}&R&D`,
    evenFooter: `&Cصفحة &P من &N`,
  };
}
