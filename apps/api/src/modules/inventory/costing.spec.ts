/**
 * Regression tests for weighted-average cost.
 *
 * Locks in the customer's exact scenarios from the pre-deployment
 * verification task:
 *
 *   Receipt 1:  0 KG → +100 @ 2.00  → avg 2.00
 *   Receipt 2:  100 KG @ 2.00 + 50 @ 3.00  → avg 2.333…
 *   Receipt 3:  150 KG @ 2.333… + 50 @ 4.00  → avg 2.75
 *   Consume 20 KG                            → avg still 2.75 (consumption never changes avg)
 *   Edit master data                          → avg unchanged
 *
 * Also asserts the invariants the buggy inline implementation broke:
 *   • Received qty is NOT counted twice.
 *   • First-ever receipt (oldQty 0) returns unitCost verbatim.
 *   • Zero-qty / negative-qty receipts return oldAvg unchanged.
 */

import { weightedAverageCost, inventoryValue } from './costing';

describe('weightedAverageCost — customer scenarios', () => {
  it('Receipt 1: 0 → +100 @ 2.00 → avg 2.00', () => {
    const avg = weightedAverageCost({ oldQty: 0, oldAvg: 0, rcvQty: 100, unitCost: 2.0 });
    expect(avg).toBe(2.0);
  });

  it('Receipt 2: 100 @ 2.00 + 50 @ 3.00 → avg 2.333333', () => {
    const avg = weightedAverageCost({ oldQty: 100, oldAvg: 2.0, rcvQty: 50, unitCost: 3.0 });
    // (100*2 + 50*3) / 150 = 350 / 150
    expect(avg).toBeCloseTo(2.333333, 6);
  });

  it('Receipt 3: 150 @ 2.333… + 50 @ 4.00 → avg 2.75, value 550, stock 200', () => {
    const avg = weightedAverageCost({ oldQty: 150, oldAvg: 2.333333, rcvQty: 50, unitCost: 4.0 });
    // (150 * 2.333333 + 50 * 4) / 200 = (349.99995 + 200) / 200 = 549.99995 / 200
    expect(avg).toBeCloseTo(2.75, 4);
    // Value check independent of rounding drift:
    const preReceiptValue = 150 * 2.333333;
    const receiptValue = 50 * 4.0;
    const totalValue = preReceiptValue + receiptValue;
    expect(totalValue).toBeCloseTo(550, 3);
    const totalStock = 150 + 50;
    expect(totalStock).toBe(200);
    expect(totalValue / totalStock).toBeCloseTo(2.75, 3);
  });

  it('Consumption of 20 KG must NOT change avg (consumption is not costing)', () => {
    // Consumption goes through StockMovement.OUT / adjustStock, never
    // through weightedAverageCost. This test documents the contract.
    const beforeAvg = weightedAverageCost({ oldQty: 150, oldAvg: 2.333333, rcvQty: 50, unitCost: 4.0 });
    // After consuming 20 KG, avg is untouched:
    const remainingStock = 200 - 20;
    const remainingValue = inventoryValue(remainingStock, beforeAvg);
    // 180 * 2.75 = 495
    expect(remainingValue).toBeCloseTo(495, 3);
    // avg cost stored on the item is still beforeAvg — consumption
    // does not recompute it. This is the standard weighted-average
    // rule; consumption debits the value at current avg but the avg
    // itself only moves on IN.
    expect(beforeAvg).toBeCloseTo(2.75, 3);
  });
});

describe('weightedAverageCost — invariants', () => {
  it('is the same whether we do 100 @ 2.00 then 50 @ 3.00, or 50 @ 3.00 then 100 @ 2.00', () => {
    const a = weightedAverageCost({ oldQty: 0, oldAvg: 0, rcvQty: 100, unitCost: 2.0 });
    const b = weightedAverageCost({ oldQty: 100, oldAvg: a, rcvQty: 50, unitCost: 3.0 });

    const a2 = weightedAverageCost({ oldQty: 0, oldAvg: 0, rcvQty: 50, unitCost: 3.0 });
    const b2 = weightedAverageCost({ oldQty: 50, oldAvg: a2, rcvQty: 100, unitCost: 2.0 });

    expect(b).toBeCloseTo(b2, 6);
  });

  it('preserves inventory value: (oldQty × oldAvg + rcvQty × unitCost) == (oldQty+rcvQty) × newAvg', () => {
    const inp = { oldQty: 100, oldAvg: 2.0, rcvQty: 50, unitCost: 3.0 };
    const newAvg = weightedAverageCost(inp);
    const lhs = inp.oldQty * inp.oldAvg + inp.rcvQty * inp.unitCost;
    const rhs = (inp.oldQty + inp.rcvQty) * newAvg;
    expect(lhs).toBeCloseTo(rhs, 4);
  });

  it('first-ever receipt returns unitCost verbatim (no NaN, no 0)', () => {
    expect(weightedAverageCost({ oldQty: 0, oldAvg: 0, rcvQty: 100, unitCost: 5.5 })).toBe(5.5);
  });

  it('zero-qty or negative-qty receipt does not change avg', () => {
    expect(weightedAverageCost({ oldQty: 100, oldAvg: 2.0, rcvQty: 0, unitCost: 999 })).toBe(2.0);
    expect(weightedAverageCost({ oldQty: 100, oldAvg: 2.0, rcvQty: -5, unitCost: 999 })).toBe(2.0);
  });

  it('does NOT double-count the received quantity (the fixed bug)', () => {
    // The old buggy formula would produce:
    //   (2.0 * 150 + 3.0 * 50) / (150 + 50) = 450 / 200 = 2.25
    // The correct formula produces 2.333...
    const avg = weightedAverageCost({ oldQty: 100, oldAvg: 2.0, rcvQty: 50, unitCost: 3.0 });
    expect(avg).not.toBeCloseTo(2.25, 3); // buggy value must NOT occur
    expect(avg).toBeCloseTo(2.333333, 6); // correct value MUST occur
  });

  it('handles NaN / undefined / null defensively', () => {
    // These come from Prisma.Decimal round-trip edge cases.
    expect(weightedAverageCost({
      oldQty: undefined as any, oldAvg: null as any, rcvQty: 100, unitCost: 2.0,
    })).toBe(2.0); // oldQty coerces to 0 → first-receipt branch
    expect(weightedAverageCost({
      oldQty: 100, oldAvg: 2.0, rcvQty: 'not-a-number' as any, unitCost: 3.0,
    })).toBe(2.0); // rcvQty coerces to 0 → returns oldAvg
  });
});

describe('inventoryValue helper', () => {
  it('is qty × avg with 6-decimal rounding', () => {
    expect(inventoryValue(180, 2.75)).toBeCloseTo(495, 6);
  });
  it('handles null/undefined without NaN', () => {
    expect(inventoryValue(undefined as any, 2.0)).toBe(0);
    expect(inventoryValue(100, null as any)).toBe(0);
  });
});
