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
