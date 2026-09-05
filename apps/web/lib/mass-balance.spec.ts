/**
 * The production screen must display exactly what the server will post.
 * These mirror the API's production-mass-balance.spec.ts so the two cannot
 * drift apart silently.
 */
import { milkMassBalance } from './mass-balance';

const kg25 = () => 25;
const milk = (count: number, itemId = 'milk') => ({ itemId, count, quantity: count * 25, unit: 'KG' });
const waste = (q: any, itemId = 'milk') => ({ itemId, quantity: q, unit: 'KG' });

describe('milkMassBalance', () => {
  it('61 sacks + 35 kg waste — the customer scenario', () => {
    const mb = milkMassBalance([milk(61)], [waste(35)], kg25);
    expect(mb.sacks).toBe(61);
    expect(mb.kgPerSack).toBe(25);
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
  ])('%s sacks, %s kg waste → gross %s net %s', (s, w, gross, net) => {
    const mb = milkMassBalance([milk(s as number)], [waste(w as number)], kg25);
    expect(mb.grossKg).toBe(gross);
    expect(mb.netKg).toBe(net);
  });

  it('accepts Arabic-Indic, Persian and the Arabic decimal separator in waste', () => {
    for (const [input, expected] of [['12.5', 12.5], ['١٢.٥', 12.5], ['١٢٫٥', 12.5], ['۱۲.۵', 12.5]] as const) {
      const mb = milkMassBalance([milk(61)], [waste(input)], kg25);
      expect(mb.wasteKg).toBe(expected);
      expect(mb.netKg).toBe(1525 - (expected as number));
    }
  });

  it('treats empty / invalid waste as zero rather than NaN', () => {
    for (const bad of ['', '   ', 'abc', null, undefined]) {
      const mb = milkMassBalance([milk(4)], [waste(bad)], kg25);
      expect(Number.isFinite(mb.wasteKg)).toBe(true);
      expect(mb.wasteKg).toBe(0);
      expect(mb.netKg).toBe(100);
    }
  });

  it('ignores waste of an item that is not the issued milk', () => {
    const mb = milkMassBalance([milk(61)], [waste(35, 'some-carton')], kg25);
    expect(mb.wasteKg).toBe(0);
    expect(mb.netKg).toBe(1525);
  });

  it('reports hasMilk=false when there are no milk rows', () => {
    expect(milkMassBalance([], [], kg25).hasMilk).toBe(false);
    expect(milkMassBalance([milk(0)], [], kg25).hasMilk).toBe(false);
  });

  it('never yields a negative net or a NaN percentage', () => {
    const mb = milkMassBalance([milk(1)], [waste(999)], kg25);
    expect(mb.netKg).toBe(0);
    expect(Number.isFinite(mb.wastePercent)).toBe(true);
  });

  it('percentage is kg/kg — 35/61 would be 57%, which is wrong', () => {
    expect(milkMassBalance([milk(61)], [waste(35)], kg25).wastePercent).toBeLessThan(3);
  });
});

/**
 * THE SAVE/RELOAD BUG.
 *
 * Before this release the API canonicalised the waste row into the item's
 * unit on the way in, so the same sheet read differently depending on
 * whether it had been reloaded:
 *
 *   in React state (just typed)   { quantity: 5,   unit: 'KG' }   → 5 كغم
 *   read back from the database   { quantity: 0.2, unit: 'BAG' }  → 0.20 كغم
 *
 * The API now stores the measurement as measured. These tests assert the
 * two shapes agree, and that the reader is not simply summing quantities.
 */
describe('save → reload agreement', () => {
  const unitOf = () => 'BAG';
  const TYPED = { itemId: 'milk', quantity: 5, unit: 'KG' };
  const PERSISTED = { itemId: 'milk', quantity: 5, unit: 'KG', unitFactor: 0.04, factorSource: 'ITEM' };

  it('shows 1,525 / 5 / 1,520 / 0.33% before the save', () => {
    const mb = milkMassBalance([milk(61)], [TYPED], kg25, unitOf);
    expect(mb.grossKg).toBe(1525);
    expect(mb.wasteKg).toBe(5);
    expect(mb.netKg).toBe(1520);
    expect(mb.wastePercent).toBeCloseTo(0.3279, 3);
  });

  it('shows the SAME figures after the reload', () => {
    const mb = milkMassBalance([milk(61)], [PERSISTED], kg25, unitOf);
    expect(mb.grossKg).toBe(1525);
    expect(mb.wasteKg).toBe(5);
    expect(mb.netKg).toBe(1520);
    expect(mb.wastePercent).toBeCloseTo(0.3279, 3);
  });

  it('never reads the old 0.2-sack shape as 0.20 kg', () => {
    // A legacy row written by the previous build really is 0.2 SACKS —
    // which is 5 kg. Reading it as 0.20 kg is the 25× understatement.
    const legacy = { itemId: 'milk', quantity: 0.2, unit: 'BAG' };
    const mb = milkMassBalance([milk(61)], [legacy], kg25, unitOf);
    expect(mb.wasteKg).toBe(5);
    expect(mb.wasteKg).not.toBe(0.2);
  });

  it('never reads a 5-kg row as 125 kg', () => {
    const mb = milkMassBalance([milk(61)], [TYPED], kg25, unitOf);
    expect(mb.wasteKg).not.toBe(125);
  });

  it('converts a grams row', () => {
    const mb = milkMassBalance([milk(61)], [{ itemId: 'milk', quantity: 5000, unit: 'G' }], kg25, unitOf);
    expect(mb.wasteKg).toBe(5);
  });

  it('flags a unit the server will refuse, instead of inventing a number', () => {
    const mb = milkMassBalance([milk(61)], [{ itemId: 'milk', quantity: 5, unit: 'PCS' }], kg25, unitOf);
    expect(mb.hasUnconvertibleWaste).toBe(true);
    expect(mb.wasteKg).toBe(0);
  });

  it('accepts Arabic-Indic and Persian digits in a persisted KG row', () => {
    for (const [input, expected] of [['٥', 5], ['٥٫٥', 5.5], ['۵', 5], ['۵.۵', 5.5]] as const) {
      const mb = milkMassBalance(
        [milk(61)],
        [{ itemId: 'milk', quantity: input, unit: 'KG' }],
        kg25,
        unitOf,
      );
      expect(mb.wasteKg).toBe(expected);
    }
  });
});
