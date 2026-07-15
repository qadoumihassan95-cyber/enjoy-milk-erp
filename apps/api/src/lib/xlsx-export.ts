/**
 * Enjoy Milk ERP — Shared Excel export design system (backend).
 *
 * Mirror of apps/web/lib/xlsx-export.ts, tuned for Node/NestJS.
 * Produces a Buffer that controllers stream back to the client with a
 * proper .xlsx Content-Type.
 *
 * Keep this file in visual sync with the web module — same palette,
 * same helpers, same sheet layout — so exports look identical whether
 * they are generated in the browser or by the API.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ExcelJS = require('exceljs');

export type CellValue = string | number | Date | null | undefined;
export type CurrencyCode = 'JOD' | 'USD';

export const FACTORY_NAME = 'مصنع الدانة لمنتجات الحليب والألبان';

export interface XlsxColumn {
  key: string;
  header: string;
  width?: number;
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
  tint?: 'blue' | 'green' | 'orange' | 'cyan' | 'yellow' | 'gray';
  strong?: boolean;
}

export interface XlsxKpi {
  label: string;
  value: CellValue;
  format?: XlsxColumn['format'];
  tint?: XlsxColumn['tint'];
}

export interface XlsxCondition {
  columnKey: string;
  when: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'contains';
  value: number | string;
  bg?: string;
  fg?: string;
}

export interface XlsxFilterMeta {
  label: string;
  value: string;
}

export interface XlsxWorkbookSpec {
  filename: string;
  reportTitle: string;
  reportTitleEn?: string;
  generatedBy?: string;
  branch?: string;
  filters?: XlsxFilterMeta[];
  currency?: CurrencyCode;
  rtl?: boolean;
  kpis?: XlsxKpi[];
  details: {
    sheetName?: string;
    columns: XlsxColumn[];
    rows: Record<string, CellValue>[];
    totals?: Record<string, CellValue>;
    conditions?: XlsxCondition[];
    highlightRow?: (row: Record<string, CellValue>, index: number) => boolean;
    footnote?: string;
  };
  signatures?: string[];
}

const PALETTE = {
  brandYellow: 'FFFDE68A',
  brandYellowDark: 'FFCA8A04',
  headerNeutral: 'FFF4F4F5',
  totalCyan: 'FFCFFAFE',
  tints: {
    blue: { bg: 'FFEFF6FF', fg: 'FF1E3A8A' },
    green: { bg: 'FFECFDF5', fg: 'FF065F46' },
    orange: { bg: 'FFFFF7ED', fg: 'FF9A3412' },
    cyan: { bg: 'FFECFEFF', fg: 'FF155E75' },
    yellow: { bg: 'FFFEFCE8', fg: 'FF854D0E' },
    gray: { bg: 'FFF4F4F5', fg: 'FF3F3F46' },
  },
} as const;

function numberFormat(fmt?: XlsxColumn['format']): string | undefined {
  switch (fmt) {
    case 'integer': return '#,##0';
    case 'decimal2': return '#,##0.00';
    case 'decimal3': return '#,##0.000';
    case 'percent': return '0.00%';
    case 'date': return 'yyyy-mm-dd';
    case 'datetime': return 'yyyy-mm-dd hh:mm';
    case 'jod': return '#,##0.000 " د.أ"';
    case 'usd': return '"$"#,##0.00';
    default: return fmt;
  }
}

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

function borderThin() {
  const c = { argb: 'FFE4E4E7' };
  return {
    top: { style: 'thin' as const, color: c },
    bottom: { style: 'thin' as const, color: c },
    left: { style: 'thin' as const, color: c },
    right: { style: 'thin' as const, color: c },
  };
}

function applyPrintHeader(sheet: any, title: string) {
  sheet.headerFooter = {
    oddHeader: `&L${FACTORY_NAME}&C${title}&R&D`,
    oddFooter: `&Cصفحة &P من &N`,
    evenHeader: `&L${FACTORY_NAME}&C${title}&R&D`,
    evenFooter: `&Cصفحة &P من &N`,
  };
}

export async function buildWorkbookBuffer(spec: XlsxWorkbookSpec): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Enjoy Milk ERP';
  wb.company = FACTORY_NAME;
  wb.created = new Date();
  wb.modified = new Date();

  const rtl = spec.rtl !== false;
  const now = new Date();
  const nowLabel = now.toLocaleString(rtl ? 'ar-JO' : 'en-US');

  /* Cover */
  const cover = wb.addWorksheet('التقرير · Cover', {
    views: [{ state: 'frozen', ySplit: 0, rightToLeft: rtl }],
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true },
  });
  cover.columns = [{ width: 34 }, { width: 60 }];

  cover.mergeCells('A1:B1');
  const brand = cover.getCell('A1');
  brand.value = FACTORY_NAME;
  brand.font = { name: 'Cairo', size: 18, bold: true, color: { argb: 'FF18181B' } };
  brand.alignment = { horizontal: 'center', vertical: 'middle', readingOrder: rtl ? 'rtl' : 'ltr' };
  brand.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALETTE.brandYellow } };
  brand.border = { bottom: { style: 'medium', color: { argb: PALETTE.brandYellowDark } } };
  cover.getRow(1).height = 40;

  cover.mergeCells('A2:B2');
  const title = cover.getCell('A2');
  title.value = spec.reportTitle + (spec.reportTitleEn ? ` · ${spec.reportTitleEn}` : '');
  title.font = { name: 'Cairo', size: 14, bold: true };
  title.alignment = { horizontal: 'center', vertical: 'middle', readingOrder: rtl ? 'rtl' : 'ltr' };
  cover.getRow(2).height = 26;

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

  coverRow += 2;
  const foot = cover.getRow(coverRow);
  cover.mergeCells(`A${coverRow}:B${coverRow}`);
  foot.getCell(1).value = 'وثيقة رسمية صادرة عن نظام Enjoy Milk ERP.';
  foot.getCell(1).font = { name: 'Cairo', italic: true, color: { argb: 'FF71717A' }, size: 10 };
  foot.getCell(1).alignment = { horizontal: 'center', readingOrder: rtl ? 'rtl' : 'ltr' };

  applyPrintHeader(cover, spec.reportTitle);

  /* KPIs */
  if (spec.kpis && spec.kpis.length > 0) {
    const kpi = wb.addWorksheet('المؤشرات · KPIs', {
      views: [{ state: 'frozen', xSplit: 0, ySplit: 1, rightToLeft: rtl }],
      pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true },
    });
    kpi.columns = [
      { header: 'المؤشر', key: 'label', width: 40 },
      { header: 'القيمة', key: 'value', width: 24 },
    ];
    kpi.getRow(1).eachCell((c: any) => {
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
      row.eachCell((c: any) => (c.border = borderThin()));
    }
    applyPrintHeader(kpi, spec.reportTitle);
  }

  /* Details */
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

  details.columns = spec.details.columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: computeWidth(c, spec.details.rows),
    style: {
      numFmt: numberFormat(c.format),
      alignment: {
        horizontal:
          c.align ??
          (['integer', 'decimal2', 'decimal3', 'percent', 'jod', 'usd'].includes(c.format ?? '')
            ? 'right'
            : rtl
              ? 'right'
              : 'left'),
        vertical: 'middle',
        readingOrder: rtl ? 'rtl' : 'ltr',
      },
    },
  }));

  const headerRow = details.getRow(1);
  headerRow.height = 28;
  headerRow.eachCell((cell: any, colNum: number) => {
    const col = spec.details.columns[colNum - 1];
    const tint = col?.tint ? PALETTE.tints[col.tint] : null;
    cell.font = { name: 'Cairo', bold: true, color: { argb: tint?.fg ?? 'FF18181B' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tint?.bg ?? PALETTE.brandYellow } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true, readingOrder: rtl ? 'rtl' : 'ltr' };
    cell.border = borderThin();
  });

  const lastCol = details.columns.length;
  details.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: lastCol } };

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

  if (spec.details.totals) {
    const totalRow = details.addRow(spec.details.totals);
    totalRow.height = 24;
    totalRow.eachCell((cell: any) => {
      cell.font = { name: 'Cairo', bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALETTE.totalCyan } };
      cell.border = { ...borderThin(), top: { style: 'medium', color: { argb: 'FF18181B' } } };
    });
  }

  if (spec.details.conditions && spec.details.conditions.length > 0) {
    for (const cond of spec.details.conditions) {
      const colIndex = spec.details.columns.findIndex((c) => c.key === cond.columnKey);
      if (colIndex < 0) continue;
      const colLetter = details.getColumn(colIndex + 1).letter;
      const firstDataRow = 2;
      const lastDataRow = spec.details.rows.length + 1;
      const range = `${colLetter}${firstDataRow}:${colLetter}${lastDataRow}`;
      const opMap: Record<XlsxCondition['when'], string> = {
        gt: 'greaterThan',
        gte: 'greaterThan',
        lt: 'lessThan',
        lte: 'lessThan',
        eq: 'equal',
        contains: 'containsText',
      };
      details.addConditionalFormatting({
        ref: range,
        rules: [
          {
            type: 'cellIs',
            priority: 1,
            operator: opMap[cond.when],
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

  if (spec.details.footnote) {
    const footRow = details.addRow([]);
    details.mergeCells(footRow.number, 1, footRow.number, Math.max(3, lastCol));
    const cell = footRow.getCell(1);
    cell.value = spec.details.footnote;
    cell.font = { name: 'Cairo', bold: true, italic: true, color: { argb: 'FF3F3F46' } };
    cell.alignment = { horizontal: rtl ? 'right' : 'left', readingOrder: rtl ? 'rtl' : 'ltr' };
  }

  if (spec.signatures && spec.signatures.length > 0) {
    details.addRow([]);
    details.addRow([]);
    const sigRow = details.addRow(spec.signatures);
    sigRow.height = 40;
    sigRow.eachCell((cell: any) => {
      cell.font = { name: 'Cairo', bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'top', readingOrder: rtl ? 'rtl' : 'ltr' };
      cell.border = { top: { style: 'thin', color: { argb: 'FF52525B' } } };
    });
  }

  applyPrintHeader(details, spec.reportTitle);

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
