/**
 * Inventory costing helpers — pure functions, no I/O.
 *
 * The weighted-average implementation used to live inline in
 * `InventoryService.receiveStock`. That version double-counted the
 * received quantity: it wrote the receipt to StockLevel first, then
 * re-read StockLevel to get `currentStock` (which already included the
 * receipt), then computed the average as
 *
 *   newAvg = (oldAvg × currentStock + unitCost × qty) / (currentStock + qty)
 *
 * — mixing PRE-receipt average with POST-receipt stock in the numerator
 * AND adding qty a second time in the denominator. On a receipt of
 * 50 KG @ 3.00 into an existing 100 KG @ 2.00 that produced 2.25
 * instead of the correct 2.333….
 *
 * This module exports a single source of truth for the formula so the
 * service and the regression test measure the same thing.
 */

/**
 * Weighted-average cost after a supplier receipt.
 *
 *   newAvg = (oldQty × oldAvg + rcvQty × unitCost) / (oldQty + rcvQty)
 *
 * Invariants:
 *   • Preserves inventory value: (oldQty × oldAvg) + (rcvQty × unitCost)
 *     is the new total inventory value.
 *   • First-ever receipt (oldQty === 0) returns unitCost verbatim.
 *   • Zero-quantity receipt (rcvQty === 0) returns oldAvg unchanged.
 *   • Never NaN / Infinity — all inputs are coerced to finite numbers
 *     and the denominator is guarded.
 *
 * Rounds to 6 decimal places to keep JSON-round-trip storage stable.
 */
export function weightedAverageCost(input: {
  oldQty: number;
  oldAvg: number;
  rcvQty: number;
  unitCost: number;
}): number {
  const oldQty = toFinite(input.oldQty, 0);
  const oldAvg = toFinite(input.oldAvg, 0);
  const rcvQty = toFinite(input.rcvQty, 0);
  const unitCost = toFinite(input.unitCost, 0);

  if (rcvQty <= 0) return oldAvg;
  if (oldQty <= 0) return unitCost;

  const totalQty = oldQty + rcvQty;
  const totalValue = oldQty * oldAvg + rcvQty * unitCost;
  const avg = totalValue / totalQty;
  return round6(avg);
}

/**
 * Inventory valuation for a given quantity at the current avg cost.
 * Trivial but centralised so reports can share the same rounding.
 */
export function inventoryValue(qty: number, avgCost: number): number {
  return round6(toFinite(qty, 0) * toFinite(avgCost, 0));
}

function toFinite(v: any, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
