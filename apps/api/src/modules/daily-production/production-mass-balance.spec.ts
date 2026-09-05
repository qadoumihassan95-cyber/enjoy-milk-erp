/**
 * Raw-milk mass balance and waste semantics.
 *
 * THE DEFECT THIS LOCKS OUT
 * -------------------------
 * Raw milk is stocked in SACKS; waste is measured in KG. Before this change
 * post() deducted EVERY waste row from stock in the item's canonical unit,
 * on top of the material already issued. Recording "35 kg wasted" therefore
 * removed 35 SACKS = 875 kg, in addition to the 61 sacks consumed — a double
 * deduction AND a unit error compounding each other.
 */

import {
  classifyWaste, wasteDeductsStock, massBalance, validateWasteKg, WasteValidationError,
} from './production-mass-balance';

const S = (...ids: string[]) => new Set(ids);

describe('waste classification', () => {
  const consumed = S('milk', 'carton');
  const produced = S('finished');

  it('waste of ISSUED material is inside the consumption — never deducted', () => {
    const kind = classifyWaste({ itemId: 'milk', consumedItemIds: consumed, producedItemIds: produced });
    expect(kind).toBe('ISSUED_MATERIAL');
    expect(wasteDeductsStock(kind)).toBe(false);
  });

  it('waste of a FINISHED good is a real separate loss', () => {
    const kind = classifyWaste({ itemId: 'finished', consumedItemIds: consumed, producedItemIds: produced });
    expect(kind).toBe('FINISHED_GOOD');
    expect(wasteDeductsStock(kind)).toBe(true);
  });

  it('waste of something neither issued nor produced here still deducts', () => {
    const kind = classifyWaste({ itemId: 'stray', consumedItemIds: consumed, producedItemIds: produced });
    expect(kind).toBe('OTHER');
    expect(wasteDeductsStock(kind)).toBe(true);
  });

  it('issued wins over produced when an item is both', () => {
    const kind = classifyWaste({ itemId: 'x', consumedItemIds: S('x'), producedItemIds: S('x') });
    expect(kind).toBe('ISSUED_MATERIAL');
  });
});

describe('mass balance — the customer scenario', () => {
  it('61 sacks × 25 kg with 35 kg waste', () => {
    const mb = massBalance(61, 25, 35);
    expect(mb.grossKg).toBe(1525);
    expect(mb.wasteKg).toBe(35);
    expect(mb.netKg).toBe(1490);
    expect(mb.wastePercent).toBeCloseTo(2.2951, 3);
  });

  it.each([
    [1, 0, 25, 25],
    [2, 5, 50, 45],
    [4, 10, 100, 90],
    [10, 0, 250, 250],
    [61, 35, 1525, 1490],
  ])('%s sacks with %s kg waste → gross %s, net %s', (sacks, waste, gross, net) => {
    const mb = massBalance(sacks as number, 25, waste as number);
    expect(mb.grossKg).toBe(gross);
    expect(mb.netKg).toBe(net);
  });

  it('percentage is kg/kg, never kg/sacks', () => {
    const mb = massBalance(61, 25, 35);
    // the wrong calculation would be 35/61*100 = 57.4%
    expect(mb.wastePercent).toBeLessThan(3);
  });

  it('handles zero and degenerate input without NaN', () => {
    for (const mb of [massBalance(0, 25, 0), massBalance(61, 0, 0), massBalance(-5, 25, -1)]) {
      expect(Number.isFinite(mb.grossKg)).toBe(true);
      expect(Number.isFinite(mb.netKg)).toBe(true);
      expect(Number.isFinite(mb.wastePercent)).toBe(true);
    }
    expect(massBalance(0, 25, 0).wastePercent).toBe(0);
  });

  it('net never goes negative', () => {
    expect(massBalance(1, 25, 999).netKg).toBe(0);
  });
});

describe('waste validation', () => {
  const gross = 1525;

  it('accepts zero and valid decimals', () => {
    expect(validateWasteKg(0, gross)).toBe(0);
    expect(validateWasteKg(35, gross)).toBe(35);
    expect(validateWasteKg(12.5, gross)).toBe(12.5);
    expect(validateWasteKg('12.5', gross)).toBe(12.5);
  });

  it('accepts waste exactly equal to gross', () => {
    expect(validateWasteKg(gross, gross)).toBe(gross);
  });

  it('rejects negative waste', () => {
    expect(() => validateWasteKg(-1, gross)).toThrow(WasteValidationError);
  });

  it('rejects waste greater than gross', () => {
    expect(() => validateWasteKg(1526, gross)).toThrow(/أكبر من إجمالي/);
  });

  it('rejects NaN, Infinity and non-numeric text', () => {
    for (const bad of [NaN, Infinity, -Infinity, 'abc', '12abc', {}, []]) {
      expect(() => validateWasteKg(bad as any, gross)).toThrow(WasteValidationError);
    }
  });

  it('treats an EMPTY field as no waste, not as an error', () => {
    // A blank waste box means "nothing was lost". Throwing here would block
    // posting a clean run, which is the common case.
    for (const empty of ['', '   ', null, undefined]) {
      expect(validateWasteKg(empty as any, gross)).toBe(0);
    }
  });
});

/**
 * The full customer scenario, asserted as an inventory ledger rather than
 * through the service (which needs the whole Prisma surface). This proves the
 * ARITHMETIC contract that post() now implements: exactly one deduction.
 */
describe('61 sacks + 35 kg waste — inventory effect', () => {
  it('deducts 61 sacks once and never re-deducts the waste', () => {
    const openingSacks = 39247;
    const issuedSacks = 61;
    const wasteKg = 35;

    const consumedItemIds = S('milk');
    const producedItemIds = S('finished');
    const kind = classifyWaste({ itemId: 'milk', consumedItemIds, producedItemIds });

    // the ledger: consumption always deducts, waste deducts only if allowed
    let stock = openingSacks - issuedSacks;
    if (wasteDeductsStock(kind)) stock -= wasteKg; // must NOT happen

    expect(kind).toBe('ISSUED_MATERIAL');
    expect(stock).toBe(39186);              // exactly 39,247 − 61
    expect(stock).not.toBe(39186 - 35);     // no second deduction
    expect(stock).not.toBeCloseTo(39184.6); // no fractional-sack drift

    const mb = massBalance(issuedSacks, 25, wasteKg);
    expect(mb.grossKg).toBe(1525);
    expect(mb.netKg).toBe(1490);
    expect(mb.wastePercent).toBeCloseTo(2.2951, 3);
  });
});
