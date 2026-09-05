/**
 * Raw-milk mass balance for the production screen.
 *
 * Mirrors apps/api/src/modules/daily-production/production-mass-balance.ts so
 * the number the operator reads is the number the server posts. Inventory is
 * kept in SACKS; the factory measures waste in KG.
 *
 * WHY THIS FILE IS UNIT-AWARE
 * ---------------------------
 * It used to add up `w.quantity` and call the total kilograms. That held
 * while the row was still in React state (the operator had just typed KG)
 * and broke the moment the sheet was reloaded from the database, because
 * the API canonicalised the row into the item's unit: 5 KG came back as
 * 0.2 BAG and the panel reported 0.20 كغم of waste on a 1,525 كغم run.
 *
 * The API now stores issued-material waste in the unit it was measured in,
 * and this reader honours whatever unit a row actually carries — so the
 * before-save and after-reload figures agree.
 */
import { parseDecimal } from './numeric';

export interface MilkMassBalance {
  hasMilk: boolean;
  sacks: number;
  kgPerSack: number;
  grossKg: number;
  wasteKg: number;
  netKg: number;
  wastePercent: number;
  /**
   * True when a waste row on a milk item carries a unit with no weight
   * meaning (a PCS row against a sack item). Such a row is excluded from
   * wasteKg here and REFUSED by the server at posting time, so the screen
   * says so before the operator presses ترحيل.
   */
  hasUnconvertibleWaste: boolean;
}

const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;
const num = (v: any) => parseDecimal(v) ?? 0;

/** Same normalisation the API applies: blank → PCS, SACK → BAG. */
function normUnit(u: any): string {
  const s = (u ?? '').toString().trim().toUpperCase();
  if (!s) return '';
  return s === 'SACK' ? 'BAG' : s;
}

/**
 * `wastages` rows whose item is one of the milk rows are treated as waste OF
 * the issued milk — exactly how the server classifies them.
 */
export function milkMassBalance(
  milkUsage: any[],
  wastages: any[],
  kgPerSackFor: (itemId?: any) => number,
  itemUnitFor?: (itemId?: any) => string | undefined,
): MilkMassBalance {
  const rows = (milkUsage ?? []).filter((m) => m && (num(m.count) > 0 || num(m.quantity) > 0));
  if (!rows.length) {
    return {
      hasMilk: false, sacks: 0, kgPerSack: 0, grossKg: 0,
      wasteKg: 0, netKg: 0, wastePercent: 0, hasUnconvertibleWaste: false,
    };
  }
  let sacks = 0;
  let grossKg = 0;
  let kgPerSack = 0;
  for (const m of rows) {
    const kg = kgPerSackFor(m.itemId) || 0;
    // `count` is the sack count the operator typed; fall back to deriving it.
    const n = num(m.count) > 0 ? num(m.count) : (kg > 0 ? num(m.quantity) / kg : 0);
    sacks += n;
    grossKg += n * kg;
    if (kg > 0) kgPerSack = kg;
  }
  const milkIds = new Set(rows.map((m) => m.itemId).filter(Boolean));

  let wasteKg = 0;
  let hasUnconvertibleWaste = false;
  for (const w of wastages ?? []) {
    if (!w || !w.itemId || !milkIds.has(w.itemId)) continue;
    const qty = num(w.quantity);
    const kgPer = kgPerSackFor(w.itemId) || 0;
    // A blank unit means the row predates unit tracking — read it as the
    // item's own unit, which is what the old API stored.
    const u = normUnit(w.unit) || normUnit(itemUnitFor?.(w.itemId)) || 'BAG';
    const itemUnit = normUnit(itemUnitFor?.(w.itemId)) || 'BAG';

    if (u === 'KG') { wasteKg += qty; continue; }
    if (u === 'G')  { wasteKg += qty / 1000; continue; }
    if (u === itemUnit && kgPer > 0) { wasteKg += qty * kgPer; continue; }

    const f = parseDecimal(w.unitFactor);
    if (f !== null && f > 0 && kgPer > 0) { wasteKg += qty * f * kgPer; continue; }

    hasUnconvertibleWaste = true;
  }

  const g = r4(grossKg);
  const wk = r4(Math.max(wasteKg, 0));
  return {
    hasMilk: true,
    sacks: r4(sacks),
    kgPerSack: r4(kgPerSack),
    grossKg: g,
    wasteKg: wk,
    netKg: r4(Math.max(g - wk, 0)),
    wastePercent: g > 0 ? r4((wk / g) * 100) : 0,
    hasUnconvertibleWaste,
  };
}
