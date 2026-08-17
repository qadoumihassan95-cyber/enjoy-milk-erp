/**
 * Unit conversion helpers — single source of truth for how KG / G / SACK
 * / BAG / PCS values relate to each other on a given inventory item.
 *
 * Enjoy Milk uses these unit values on `Item.unit`:
 *   PCS  — countable pieces (finished cartons, retail packs)
 *   CTN  — carton
 *   KG   — kilograms
 *   G    — grams
 *   BAG  — sack of powder (kg per sack stored in Item.bagWeightKg)
 *   ROLL — roll of aluminum foil (usually counted, weight tracked separately)
 *
 * We deliberately keep the current schema intact — the BAG unit + the
 * `bagWeightKg` column play the role of SACK + kgPerSack the task
 * describes. Consumers only need this helper if they want to compare
 * two quantities that were captured in different units (e.g., a raw
 * milk item stocked as BAG being consumed as KG on the production sheet).
 *
 * Rules
 * -----
 *   • Never assume a global "1 sack = 25 kg". Every item that stocks in
 *     BAG must carry its own `bagWeightKg`. When it doesn't, we throw
 *     rather than silently guess.
 *   • G ↔ KG is universally 1000 (physical constant), no per-item
 *     configuration needed.
 *   • BAG → KG requires `bagWeightKg`; BAG → PCS is not defined.
 *   • CTN → PCS uses `packsPerCarton` when present.
 */

export interface ConvertibleItem {
  unit?: string | null;
  bagWeightKg?: any; // Prisma.Decimal | number | string | null
  packsPerCarton?: number | null;
  gramsPerUnit?: any; // Prisma.Decimal | number | string | null
}

/**
 * Legacy fallback for BAG→KG when an item has no `bagWeightKg`.
 *
 * This number used to be hardcoded in five places (two web pages, the API
 * summary, the web report, a display fallback) and was the ONLY conversion
 * that touched real inventory. It is kept here, in one place, purely for
 * backward compatibility: at the time of writing NO item in the database
 * has `bagWeightKg` configured, so removing the fallback outright would
 * stop production posting.
 *
 * It is never used silently. Every row converted with it records
 * factorSource = 'LEGACY_DEFAULT', which the reconciliation report lists so
 * the remaining items can be configured and the fallback eventually
 * retired.
 */
export const LEGACY_BAG_KG = 25;

/** Where the conversion factor on a stored row came from. */
export type FactorSource =
  /** Same unit both sides — factor is exactly 1. */
  | 'IDENTITY'
  /** A physical constant (G↔KG). Not configurable, cannot drift. */
  | 'PHYSICAL'
  /** Read from the item's own configuration. The goal state. */
  | 'ITEM'
  /** LEGACY_BAG_KG was used because the item is not configured. */
  | 'LEGACY_DEFAULT'
  /** Operator typed the target quantity directly; no factor applied. */
  | 'MANUAL';

export interface ResolvedConversion {
  /** Quantity expressed in the item's own unit. */
  quantity: number;
  /** Multiplier applied: quantity = input × factor. */
  factor: number;
  factorSource: FactorSource;
}

/**
 * Normalise unit string (uppercase, trim, empty → PCS).
 *
 * SACK is accepted as an alias of BAG — the task description uses SACK,
 * the schema and the Arabic UI use BAG/شوال. Treating them as one unit
 * avoids a second vocabulary for the same physical thing.
 */
export function normaliseUnit(u: string | null | undefined): string {
  // A blank or whitespace-only string used to fall through as '' despite the
  // documented "empty → PCS" contract, so a row with unit '' compared equal
  // to nothing and every conversion involving it threw "تحويل غير مدعوم".
  const s = (u ?? '').toString().trim().toUpperCase();
  if (!s) return 'PCS';
  return s === 'SACK' ? 'BAG' : s;
}

/** Read a Decimal-ish field as a plain finite number, or return null. */
function num(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Convert `qty` expressed in `fromUnit` into the item's stocked unit.
 *
 * Returns a plain number in the item's declared `Item.unit`. Throws when
 * the conversion is impossible (missing bagWeightKg, unknown unit pair,
 * negative or non-finite input).
 *
 * Examples (item.unit === 'BAG', item.bagWeightKg = 25):
 *   convertToItemUnit(item, 100, 'KG')  ==>  4     (100 kg / 25 = 4 sacks)
 *   convertToItemUnit(item, 2,   'BAG') ==>  2
 *   convertToItemUnit(item, 500, 'G')   ==>  0.02  (0.5 kg / 25)
 *
 * Examples (item.unit === 'KG'):
 *   convertToItemUnit(item, 500, 'G')   ==>  0.5
 *   convertToItemUnit(item, 2,   'BAG')  requires item.bagWeightKg → returns bagWeightKg × 2
 */
export function convertToItemUnit(
  item: ConvertibleItem,
  qty: number,
  fromUnit: string,
): number {
  if (!Number.isFinite(qty) || qty < 0) {
    throw new Error(`الكمية غير صالحة للتحويل: ${qty}`);
  }
  const to = normaliseUnit(item.unit);
  const from = normaliseUnit(fromUnit);
  if (from === to) return qty;

  // Universal G ↔ KG conversion. Order matters — check exact pair first.
  if (from === 'G' && to === 'KG') return qty / 1000;
  if (from === 'KG' && to === 'G') return qty * 1000;

  // BAG ↔ KG / G — requires per-item bagWeightKg.
  const bagKg = num(item.bagWeightKg);
  if (from === 'BAG' && to === 'KG') {
    if (bagKg === null || bagKg <= 0) throw missingBagWeight();
    return qty * bagKg;
  }
  if (from === 'BAG' && to === 'G') {
    if (bagKg === null || bagKg <= 0) throw missingBagWeight();
    return qty * bagKg * 1000;
  }
  if (from === 'KG' && to === 'BAG') {
    if (bagKg === null || bagKg <= 0) throw missingBagWeight();
    return qty / bagKg;
  }
  if (from === 'G' && to === 'BAG') {
    if (bagKg === null || bagKg <= 0) throw missingBagWeight();
    return qty / 1000 / bagKg;
  }

  // CTN ↔ PCS uses packsPerCarton.
  const packs = item.packsPerCarton;
  if (from === 'CTN' && to === 'PCS') {
    if (!packs || packs <= 0) throw missingPacksPerCarton();
    return qty * packs;
  }
  if (from === 'PCS' && to === 'CTN') {
    if (!packs || packs <= 0) throw missingPacksPerCarton();
    return qty / packs;
  }

  throw new Error(
    `تحويل غير مدعوم بين "${from}" و "${to}" على هذا الصنف`,
  );
}

function missingBagWeight() {
  return new Error(
    'وزن الشوال (bagWeightKg) غير محدد على الصنف — لا يمكن التحويل بين الشوال والكيلوغرام. حرر الصنف وعيّن "وزن الشوال الواحد".',
  );
}
function missingPacksPerCarton() {
  return new Error(
    'عدد العبوات في الكرتون (packsPerCarton) غير محدد على الصنف — لا يمكن التحويل بين الكرتون والحبة.',
  );
}

/**
 * Convert AND report which factor was used, so the caller can persist it.
 *
 * This is the entry point production posting uses. `convertToItemUnit`
 * above throws when an item is not configured; this variant falls back to
 * LEGACY_BAG_KG for BAG↔KG only, and labels the result so the shortcut is
 * visible in the data rather than assumed.
 *
 * Why persist the factor at all: without it a historical production sheet
 * cannot be reproduced. `Item.bagWeightKg` is editable, and the old
 * hardcoded 25 lived in source — change either and every past sheet
 * silently re-reports a different weight than the one actually deducted.
 * Storing `factor` on the row makes the transaction self-describing.
 *
 * No legacy fallback exists for CTN↔PCS: there is no defensible global
 * "packs per carton", so an unconfigured item throws exactly as before.
 */
export function resolveConversion(
  item: ConvertibleItem,
  qty: number,
  fromUnit: string,
): ResolvedConversion {
  if (!Number.isFinite(qty) || qty < 0) {
    throw new Error(`الكمية غير صالحة للتحويل: ${qty}`);
  }
  const to = normaliseUnit(item.unit);
  const from = normaliseUnit(fromUnit);

  if (from === to) {
    return { quantity: qty, factor: 1, factorSource: 'IDENTITY' };
  }

  if (from === 'G' && to === 'KG') {
    return { quantity: qty / 1000, factor: 1 / 1000, factorSource: 'PHYSICAL' };
  }
  if (from === 'KG' && to === 'G') {
    return { quantity: qty * 1000, factor: 1000, factorSource: 'PHYSICAL' };
  }

  const bagKg = num(item.bagWeightKg);
  const configured = bagKg !== null && bagKg > 0;
  const kgPerBag = configured ? (bagKg as number) : LEGACY_BAG_KG;
  const src: FactorSource = configured ? 'ITEM' : 'LEGACY_DEFAULT';

  if (from === 'BAG' && to === 'KG') {
    return { quantity: qty * kgPerBag, factor: kgPerBag, factorSource: src };
  }
  if (from === 'KG' && to === 'BAG') {
    return { quantity: qty / kgPerBag, factor: 1 / kgPerBag, factorSource: src };
  }
  if (from === 'BAG' && to === 'G') {
    const f = kgPerBag * 1000;
    return { quantity: qty * f, factor: f, factorSource: src };
  }
  if (from === 'G' && to === 'BAG') {
    const f = 1 / (kgPerBag * 1000);
    return { quantity: qty * f, factor: f, factorSource: src };
  }

  // CTN ↔ PCS — per-item only, no global default is defensible.
  const packs = item.packsPerCarton;
  if (from === 'CTN' && to === 'PCS') {
    if (!packs || packs <= 0) throw missingPacksPerCarton();
    return { quantity: qty * packs, factor: packs, factorSource: 'ITEM' };
  }
  if (from === 'PCS' && to === 'CTN') {
    if (!packs || packs <= 0) throw missingPacksPerCarton();
    return { quantity: qty / packs, factor: 1 / packs, factorSource: 'ITEM' };
  }

  throw new Error(`تحويل غير مدعوم بين "${from}" و "${to}" على هذا الصنف`);
}

/** Convenience: KG equivalent for reporting/aggregation. Returns null for
 *  units that don't map to a weight (PCS, CTN with no packsPerCarton, ROLL). */
export function toKg(item: ConvertibleItem, qty: number): number | null {
  const u = normaliseUnit(item.unit);
  if (u === 'KG') return qty;
  if (u === 'G') return qty / 1000;
  if (u === 'BAG') {
    const bagKg = num(item.bagWeightKg);
    return bagKg && bagKg > 0 ? qty * bagKg : null;
  }
  return null;
}
