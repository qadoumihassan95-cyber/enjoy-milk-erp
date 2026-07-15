/**
 * Single source of truth for payroll numbers rendered anywhere in the web app.
 *
 * Used by:
 *   - /payroll                (interactive editor — desktop & mobile)
 *   - /payroll/sheet          (official printable statement)
 *   - PDF (window.print from /payroll/sheet)
 *   - Excel export (both pages)
 *
 * Both pages MUST derive their numbers from this file. Every rendered value
 * is recomputed here from the raw component fields — we never trust the
 * backend's derived fields (grossSalary, employeeSS, companySS, netSalary,
 * totalDeductions) because they may be stale relative to the current company
 * policy on what enters the SS base. The raw fields (baseSalary, transport,
 * overtime, advance, attendance) ARE trusted from backend, and dirty
 * overrides from the interactive editor take precedence.
 *
 * Company policy (locked here — do not diverge in any UI file):
 *   Gross Salary            = Basic + Transportation + Overtime
 *   SS Base                 = Basic Salary ONLY  (NOT gross, NOT basic+transport)
 *   Employee SS (7.5%)      = Basic × 0.075
 *   Company  SS (14.25%)    = Basic × 0.1425
 *   Total Deductions        = Employee SS + Employee Advance + Attendance Deduction
 *   Net Salary              = Gross − Total Deductions
 *   Total Company Cost      = Gross + Company SS
 *
 * The `settings.socialSecurityBasis` parameter is accepted for backward
 * compatibility but is intentionally ignored — the SS base is fixed to
 * Basic Salary per company policy. Rates are read from settings if provided
 * (allowing the government to raise them later without a code change).
 */

export type SSBasis = 'GROSS' | 'BASIC_PLUS_TRANSPORT' | 'BASIC';

export interface PayrollSettings {
  employeeSSRate?: number;
  companySSRate?: number;
  socialSecurityBasis?: SSBasis | string; // accepted, ignored
}

export interface PayrollRowInput {
  baseSalary?: number | string | null;
  transportAllowance?: number | string | null;
  overtimeAmount?: number | string | null;
  advanceDeduction?: number | string | null;
  attendanceDeduction?: number | string | null;
  /* Backend-derived fields — accepted in the type for compat, but ignored
     by this calculator. All rendered numbers are recomputed from raw fields. */
  grossSalary?: number | string | null;
  employeeSS?: number | string | null;
  companySS?: number | string | null;
  totalDeductions?: number | string | null;
  netSalary?: number | string | null;
  net?: number | string | null;
}

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

function toNum(v: unknown): number {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Round to JOD precision (3 decimals). Eliminates IEEE754 drift like
 *  400 × 0.1425 = 56.99999999999999 so displayed and stored values agree. */
function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function hasValue(v: unknown): boolean {
  return v != null && v !== '';
}

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
 * Compute the effective values for one payroll row. Same rules everywhere:
 *   - Gross = Basic + Transport + Overtime
 *   - SS Base = Basic Salary ONLY
 *   - Employee SS = Basic × rate  (default 7.5%)
 *   - Company  SS = Basic × rate  (default 14.25%)
 *   - Net Ded = Employee SS + Advance + Attendance
 *   - Net = Gross − Net Ded
 *   - Total Company Cost = Gross + Company SS
 *
 * Backend-derived fields (grossSalary, employeeSS, …) are IGNORED. Dirty
 * overrides from the interactive editor win over backend raw fields.
 */
export function computePayrollRow(
  row: PayrollRowInput,
  settings?: PayrollSettings | null,
  dirty?: PayrollDirty,
): PayrollComputed {
  const base       = hasValue(dirty?.baseSalary)         ? toNum(dirty!.baseSalary)         : toNum(row.baseSalary);
  const transport  = hasValue(dirty?.transportOverride)  ? toNum(dirty!.transportOverride)  : toNum(row.transportAllowance);
  const overtime   = hasValue(dirty?.overtimeAmount)     ? toNum(dirty!.overtimeAmount)     : toNum(row.overtimeAmount);
  const advance    = hasValue(dirty?.advanceDeduction)   ? toNum(dirty!.advanceDeduction)   : toNum(row.advanceDeduction);
  const attendance = hasValue(dirty?.attendanceOverride) ? toNum(dirty!.attendanceOverride) : toNum(row.attendanceDeduction);

  const empSSRate  = toNum(settings?.employeeSSRate)  || DEFAULT_EMP_SS_RATE;
  const compSSRate = toNum(settings?.companySSRate)   || DEFAULT_COMP_SS_RATE;

  const gross     = r3(base + transport + overtime);
  const ssBase    = base; // ← company policy: SS on Basic only
  const empSS     = r3(ssBase * empSSRate);
  const compSS    = r3(ssBase * compSSRate);
  const totalDed  = r3(empSS + advance + attendance);
  const net       = r3(gross - totalDed);

  return {
    base: r3(base),
    transport: r3(transport),
    overtime: r3(overtime),
    advance: r3(advance),
    attendance: r3(attendance),
    gross, empSS, compSS, totalDed, net,
    totalCompanyCost: r3(gross + compSS),
  };
}

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
