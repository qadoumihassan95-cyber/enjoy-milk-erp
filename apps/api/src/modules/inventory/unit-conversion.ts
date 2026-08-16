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

/** Normalise unit string (uppercase, trim, empty → PCS). */
export function normaliseUnit(u: string | null | undefined): string {
  return (u ?? 'PCS').toString().trim().toUpperCase();
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
