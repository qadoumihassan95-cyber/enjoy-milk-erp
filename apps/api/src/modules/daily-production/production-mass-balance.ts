/**
 * Raw-material mass balance and waste classification.
 *
 * WHY THIS EXISTS
 * ---------------
 * Raw milk is stocked in SACKS (the Item's canonical unit is BAG) but the
 * factory measures production waste in KILOGRAMS. Two different units for the
 * same material, and the ERP previously conflated them:
 *
 *   1. Every waste row was deducted from stock in the ITEM's unit, so
 *      "35 kg wasted" removed 35 SACKS — 875 kg — from inventory.
 *   2. That deduction happened ON TOP of the 61 sacks already issued to the
 *      sheet, double-counting material that had already left the warehouse.
 *
 * The correct model, per the factory's workflow:
 *   · 61 sacks are ISSUED to production  → inventory −61 sacks.
 *   · Those 61 sacks are 61 × 25 = 1,525 kg of material physically handed over.
 *   · 35 kg of that 1,525 kg is lost during the run.
 *   · Inventory is NOT touched again — the 35 kg is already inside the 61
 *     sacks. It is a YIELD measurement, not a second withdrawal.
 *
 * So waste is classified by whether the material was already issued on THIS
 * sheet. Waste of something never issued here (a sack torn in the warehouse,
 * a damaged finished carton) remains a real, separate stock loss.
 */

/** How a waste row relates to the sheet it belongs to. */
export type WasteKind =
  /** Item was consumed by this sheet — waste is inside the issued quantity. */
  | 'ISSUED_MATERIAL'
  /** Item was produced by this sheet — a finished-goods loss. */
  | 'FINISHED_GOOD'
  /** Neither consumed nor produced here — an independent stock loss. */
  | 'OTHER';

export interface WasteClassificationInput {
  itemId?: string | null;
  /** Item ids consumed as inputs on this sheet (milk, carton, aluminium…). */
  consumedItemIds: ReadonlySet<string>;
  /** Item ids produced as outputs on this sheet. */
  producedItemIds: ReadonlySet<string>;
}

/**
 * Decide how a waste row must be treated at posting time.
 *
 * ISSUED_MATERIAL is checked FIRST: if an item was issued to this sheet, any
 * waste of it is part of that issue, whatever else it might also be.
 */
export function classifyWaste(input: WasteClassificationInput): WasteKind {
  const id = input.itemId ?? '';
  if (!id) return 'OTHER';
  if (input.consumedItemIds.has(id)) return 'ISSUED_MATERIAL';
  if (input.producedItemIds.has(id)) return 'FINISHED_GOOD';
  return 'OTHER';
}

/** True when this waste row must NOT move stock or consume FIFO again. */
export function wasteDeductsStock(kind: WasteKind): boolean {
  return kind !== 'ISSUED_MATERIAL';
}

export interface MassBalance {
  /** Sacks (or whatever the item's canonical unit is) issued to production. */
  issuedQty: number;
  /** kg per sack used for the conversion. */
  kgPerUnit: number;
  /** issuedQty × kgPerUnit. */
  grossKg: number;
  /** Waste recorded in kg. */
  wasteKg: number;
  /** grossKg − wasteKg, never below zero. */
  netKg: number;
  /** wasteKg / grossKg × 100, or 0 when grossKg is 0. */
  wastePercent: number;
}

/**
 * Compute the raw-material mass balance in kilograms.
 *
 * The percentage is deliberately kg/kg. Dividing kg by sacks
 * (35 / 61) mixes units and produced a meaningless figure.
 */
export function massBalance(
  issuedQty: number,
  kgPerUnit: number,
  wasteKg: number,
): MassBalance {
  const qty = Number.isFinite(issuedQty) && issuedQty > 0 ? issuedQty : 0;
  const kg = Number.isFinite(kgPerUnit) && kgPerUnit > 0 ? kgPerUnit : 0;
  const waste = Number.isFinite(wasteKg) && wasteKg > 0 ? wasteKg : 0;
  const grossKg = round4(qty * kg);
  const wasteKgSafe = round4(Math.min(waste, grossKg > 0 ? waste : waste));
  const netKg = round4(Math.max(grossKg - wasteKgSafe, 0));
  const wastePercent = grossKg > 0 ? round4((wasteKgSafe / grossKg) * 100) : 0;
  return { issuedQty: qty, kgPerUnit: kg, grossKg, wasteKg: wasteKgSafe, netKg, wastePercent };
}

function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

export class WasteValidationError extends Error {}

/**
 * Validate a waste quantity in kilograms.
 *
 * Rejects negatives, NaN, Infinity and anything above the gross issued
 * weight. Zero is valid — a run with no loss is normal.
 */
export function validateWasteKg(value: unknown, grossKg: number): number {
  // Reject non-primitives outright. `String([])` is '' and `Number('')` is 0,
  // so an array or object would otherwise sail through as "no waste" instead
  // of being reported as the malformed payload it is.
  if (value !== null && typeof value === 'object') {
    throw new WasteValidationError('كمية التوالف غير صالحة');
  }
  const raw = value === null || value === undefined ? '' : String(value).trim();
  // An absent value means "nothing was lost" — a clean run must still post.
  if (raw === '') return 0;
  const n = typeof value === 'number' ? value : Number(raw);
  if (!Number.isFinite(n)) {
    throw new WasteValidationError('كمية التوالف غير صالحة');
  }
  if (n < 0) {
    throw new WasteValidationError('لا يمكن أن تكون التوالف بالسالب');
  }
  if (Number.isFinite(grossKg) && grossKg >= 0 && n > grossKg + 1e-9) {
    throw new WasteValidationError(
      `التوالف (${n} كغم) أكبر من إجمالي الحليب الخام (${grossKg} كغم)`,
    );
  }
  return round4(n);
}
