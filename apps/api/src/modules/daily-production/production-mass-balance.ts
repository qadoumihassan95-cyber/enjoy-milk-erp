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

import { normaliseUnit, resolveConversion, LEGACY_BAG_KG } from '../inventory/unit-conversion';


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
export function validateWasteKg(
  value: unknown,
  grossKg: number,
  label = 'الحليب الخام',
  unitLabel = 'كغم',
): number {
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
      `التوالف (${n} ${unitLabel}) أكبر من إجمالي ${label} (${grossKg} ${unitLabel})`,
    );
  }
  return round4(n);
}

// ═════════════════════════════════════════════════════════════════════
//  R4 STORAGE MODEL — reading a persisted waste row
// ═════════════════════════════════════════════════════════════════════
//
// Issued-material waste is a YIELD MEASUREMENT, not an inventory
// withdrawal, so it is stored exactly as the operator measured it:
//
//     quantity = 5      unit = KG      (raw milk, Item.unit = BAG)
//
// It is deliberately NOT canonicalised into the item's inventory unit.
// Canonicalising turned "5 kg lost" into "0.2 sacks lost" and the
// production screen then reported 0.20 كغم of waste on a 1,525 كغم run —
// a 25× under-statement of the loss.
//
// The row stays historically unambiguous without a schema change because
// `unitFactor` snapshots how ONE measured unit related to the item's
// inventory unit at entry time (5 KG → factor 0.04 → 0.2 BAG → 25 kg per
// sack). Reporting therefore never depends on a later edit to
// Item.bagWeightKg.
//
// INVARIANT (both storage shapes): `unit` always describes `quantity`,
// and `unitFactor` always converts the measured unit into the item's
// inventory unit.


export interface WasteRowLike {
  quantity?: any;
  unit?: string | null;
  unitFactor?: any;
  factorSource?: string | null;
}

export interface WeighableItem {
  unit?: string | null;
  bagWeightKg?: any;
  packsPerCarton?: number | null;
  gramsPerUnit?: any;
}

/** Read a Decimal-ish value as a finite number, or null. */
function fin(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'object' && !(typeof v?.toString === 'function')) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** The unit a stored row's `quantity` is actually expressed in. */
export function rowUnit(row: WasteRowLike, item: WeighableItem): string {
  const raw = row?.unit;
  const blank = raw === null || raw === undefined || String(raw).trim() === '';
  return normaliseUnit(blank ? item?.unit : raw);
}

/**
 * Kilograms represented by ONE unit of the item's own stocked unit, or
 * null when the item has no weight interpretation (PCS / CTN / ROLL).
 */
export function kgPerItemUnit(item: WeighableItem): number | null {
  const u = normaliseUnit(item?.unit);
  if (u === 'KG') return 1;
  if (u === 'G') return 0.001;
  if (u === 'BAG') {
    const w = fin(item?.bagWeightKg);
    return w !== null && w > 0 ? w : LEGACY_BAG_KG;
  }
  return null;
}

/**
 * Express a stored waste row in KILOGRAMS.
 *
 * Throws WasteValidationError on a malformed quantity, a unit with no
 * weight meaning for this item, or conversion metadata that cannot
 * reconcile the two — which is exactly the "invalid unit / invalid
 * conversion metadata" rejection the posting gate needs.
 */
export function wasteRowKg(row: WasteRowLike, item: WeighableItem): number {
  const qty = fin(row?.quantity);
  if (qty === null) throw new WasteValidationError('كمية التوالف غير صالحة');
  if (qty < 0) throw new WasteValidationError('لا يمكن أن تكون التوالف بالسالب');

  const u = rowUnit(row, item);
  if (u === 'KG') return round4(qty);
  if (u === 'G') return round4(qty / 1000);

  const kgPer = kgPerItemUnit(item);
  const itemUnit = normaliseUnit(item?.unit);
  if (u === itemUnit && kgPer !== null) return round4(qty * kgPer);

  // Different units: try a live conversion, then fall back to the factor
  // snapshotted on the row itself (which survives item reconfiguration).
  if (kgPer !== null) {
    try {
      return round4(resolveConversion(item as any, qty, u).quantity * kgPer);
    } catch {
      /* fall through to the stored snapshot */
    }
    const f = fin(row?.unitFactor);
    if (f !== null && f > 0) return round4(qty * f * kgPer);
  }
  throw new WasteValidationError(
    `وحدة التوالف "${u}" لا يمكن تحويلها إلى كيلوغرام لهذا الصنف`,
  );
}

/**
 * Express a stored waste row in the ITEM's inventory unit — what a real
 * stock loss must deduct.
 *
 * Unlike wasteRowKg this degrades rather than throws: a nonsense
 * historical unit label (300 "L" against a PCS item exists in live data)
 * must not make an old sheet unpostable. The quantity passes through and
 * the caller records it as-is, exactly as before this change.
 */
export function wasteQtyInItemUnit(row: WasteRowLike, item: WeighableItem): number {
  const qty = fin(row?.quantity) ?? 0;
  if (!item) return qty;
  const u = rowUnit(row, item);
  if (u === normaliseUnit(item?.unit)) return qty;
  try {
    return round4(resolveConversion(item as any, qty, u).quantity);
  } catch {
    const f = fin(row?.unitFactor);
    if (f !== null && f > 0) return round4(qty * f);
    return qty;
  }
}
