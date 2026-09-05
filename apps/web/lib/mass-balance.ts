/**
 * Raw-milk mass balance for the production screen.
 *
 * Mirrors apps/api/src/modules/daily-production/production-mass-balance.ts so
 * the number the operator reads is the number the server posts. Inventory is
 * kept in SACKS; the factory measures waste in KG.
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
}

const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;
const num = (v: any) => parseDecimal(v) ?? 0;

/**
 * `wastages` rows whose item is one of the milk rows are treated as waste OF
 * the issued milk, measured in KG — exactly how the server classifies them.
 */
export function milkMassBalance(
  milkUsage: any[],
  wastages: any[],
  kgPerSackFor: (itemId?: any) => number,
): MilkMassBalance {
  const rows = (milkUsage ?? []).filter((m) => m && (num(m.count) > 0 || num(m.quantity) > 0));
  if (!rows.length) {
    return { hasMilk: false, sacks: 0, kgPerSack: 0, grossKg: 0, wasteKg: 0, netKg: 0, wastePercent: 0 };
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
  const wasteKg = (wastages ?? [])
    .filter((w) => w && w.itemId && milkIds.has(w.itemId))
    .reduce((s, w) => s + num(w.quantity), 0);

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
  };
}
