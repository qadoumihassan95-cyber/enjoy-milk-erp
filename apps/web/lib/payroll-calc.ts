/**
 * Single source of truth for payroll numbers rendered anywhere in the web app.
 *
 * Both `/payroll` (the interactive editor) and `/payroll/sheet` (the official
 * printable statement) MUST derive their numbers from this file — the two
 * pages historically diverged because each recomputed the SS/gross/net locally
 * with slightly different fallbacks, producing different totals for the same
 * month.
 *
 * Rules:
 *   1) When a row has NO unsaved edits AND the backend provided the pre-
 *      computed values (`grossSalary`, `employeeSS`, `companySS`, `netSalary`,
 *      `totalDeductions`) — those are the authoritative numbers and we return
 *      them verbatim. The backend is always the source of truth for saved data.
 *   2) When a row has unsaved edits (dirty overrides), we recompute using the
 *      SAME formula the backend uses, driven by the same settings the backend
 *      is configured with (rates + basis). This way "live" numbers on the
 *      editor match exactly what the backend will store once the user saves.
 *
 * NEVER inline the payroll formula anywhere else. Always import from here.
 */

export type SSBasis = 'GROSS' | 'BASIC_PLUS_TRANSPORT' | 'BASIC';

export interface PayrollSettings {
  employeeSSRate?: number;
  companySSRate?: number;
  socialSecurityBasis?: SSBasis | string;
}

export interface PayrollRowInput {
  baseSalary?: number | string | null;
  transportAllowance?: number | string | null;
  overtimeAmount?: number | string | null;
  advanceDeduction?: number | string | null;
  attendanceDeduction?: number | string | null;
  /* Backend pre-computed values (authoritative when present + not dirty). */
  grossSalary?: number | string | null;
  employeeSS?: number | string | null;
  companySS?: number | string | null;
  totalDeductions?: number | string | null;
  netSalary?: number | string | null;
  net?: number | string | null;
}

/** Field overrides coming from the interactive editor (unsaved). */
export interface PayrollDirty {
  baseSalary?: number | string | null;
  transportOverride?: number | string | null;
  overtimeAmount?: number | string | null;
  advanceDeduction?: number | string | null;
  attendanceOverride?: number | string | null;
}

export interface PayrollComputed {
  base: number;
  transport: number;
  overtime: number;
  advance: number;
  attendance: number;
  gross: number;
  empSS: number;
  compSS: number;
  totalDed: number;
  net: number;
  totalCompanyCost: number;
}

const DEFAULT_EMP_SS_RATE = 0.075;
const DEFAULT_COMP_SS_RATE = 0.1425;
const DEFAULT_BASIS: SSBasis = 'BASIC_PLUS_TRANSPORT';

function toNum(v: unknown): number {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function hasValue(v: unknown): boolean {
  return v != null && v !== '';
}

/** True if any dirty override is present (empty string counts as "not set"). */
export function isRowDirty(dirty: PayrollDirty | undefined | null): boolean {
  if (!dirty) return false;
  return (
    hasValue(dirty.baseSalary) ||
    hasValue(dirty.transportOverride) ||
    hasValue(dirty.overtimeAmount) ||
    hasValue(dirty.advanceDeduction) ||
    hasValue(dirty.attendanceOverride)
  );
}

/**
 * Compute the effective (rendered) values for one payroll row. Returns the
 * exact numbers the UI should display AND the numbers the Excel/PDF exporters
 * should use — no other rounding or transformation should happen downstream.
 */
export function computePayrollRow(
  row: PayrollRowInput,
  settings: PayrollSettings | undefined | null,
  dirty?: PayrollDirty,
): PayrollComputed {
  // Effective raw components (dirty overrides win when present).
  const base       = hasValue(dirty?.baseSalary)         ? toNum(dirty!.baseSalary)         : toNum(row.baseSalary);
  const transport  = hasValue(dirty?.transportOverride)  ? toNum(dirty!.transportOverride)  : toNum(row.transportAllowance);
  const overtime   = hasValue(dirty?.overtimeAmount)     ? toNum(dirty!.overtimeAmount)     : toNum(row.overtimeAmount);
  const advance    = hasValue(dirty?.advanceDeduction)   ? toNum(dirty!.advanceDeduction)   : toNum(row.advanceDeduction);
  const attendance = hasValue(dirty?.attendanceOverride) ? toNum(dirty!.attendanceOverride) : toNum(row.attendanceDeduction);

  const rowIsDirty = isRowDirty(dirty);
  const backendHasValues = row.grossSalary != null || row.netSalary != null || row.net != null;

  // Path A — clean row + backend has pre-computed values → trust backend.
  if (!rowIsDirty && backendHasValues) {
    const gross    = toNum(row.grossSalary);
    const empSS    = toNum(row.employeeSS);
    const compSS   = toNum(row.companySS);
    const totalDed = toNum(row.totalDeductions);
    const net      = toNum(row.netSalary ?? row.net);
    return {
      base, transport, overtime, advance, attendance,
      gross, empSS, compSS, totalDed, net,
      totalCompanyCost: gross + compSS,
    };
  }

  // Path B — recompute using the same formula the backend uses.
  const empSSRate  = toNum(settings?.employeeSSRate)  || DEFAULT_EMP_SS_RATE;
  const compSSRate = toNum(settings?.companySSRate)   || DEFAULT_COMP_SS_RATE;
  const basis      = (settings?.socialSecurityBasis || DEFAULT_BASIS) as SSBasis;

  const gross = base + overtime + transport;
  const ssBase =
    basis === 'GROSS'                 ? gross :
    basis === 'BASIC_PLUS_TRANSPORT'  ? base + transport :
    /* BASIC */                          base;
  const empSS    = ssBase * empSSRate;
  const compSS   = ssBase * compSSRate;
  const totalDed = empSS + advance + attendance;
  const net      = gross - totalDed;

  return {
    base, transport, overtime, advance, attendance,
    gross, empSS, compSS, totalDed, net,
    totalCompanyCost: gross + compSS,
  };
}

/**
 * Aggregate a list of computed rows into totals. All figures shown at the
 * bottom of the payroll table (and in KPIs/Excel/PDF) MUST go through this.
 */
export function computePayrollTotals(rows: PayrollComputed[]) {
  const acc = {
    baseSalary: 0, transport: 0, overtime: 0,
    advance: 0, attendance: 0,
    gross: 0, empSS: 0, compSS: 0,
    netDed: 0, net: 0,
    totalCompanyCost: 0,
    count: rows.length,
  };
  for (const r of rows) {
    acc.baseSalary       += r.base;
    acc.transport        += r.transport;
    acc.overtime         += r.overtime;
    acc.advance          += r.advance;
    acc.attendance       += r.attendance;
    acc.gross            += r.gross;
    acc.empSS            += r.empSS;
    acc.compSS           += r.compSS;
    acc.netDed           += r.totalDed;
    acc.net              += r.net;
    acc.totalCompanyCost += r.totalCompanyCost;
  }
  return acc;
}
