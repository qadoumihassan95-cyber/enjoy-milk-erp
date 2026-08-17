import {
  resolveConversion,
  normaliseUnit,
  LEGACY_BAG_KG,
} from './unit-conversion';

/**
 * Stage 4.3 — decision 2b: per-item factor, flagged fallback, factor
 * persisted per transaction row.
 *
 * The contract these tests pin:
 *   - a configured item uses ITS OWN factor, never the legacy 25
 *   - an unconfigured item still works, but is LABELLED as having used the
 *     fallback so it can be found and fixed
 *   - the returned factor always satisfies quantity = input × factor, which
 *     is what makes a stored row reproducible
 */

const bagItem = (bagWeightKg: any, unit = 'KG') => ({ unit, bagWeightKg });

describe('normaliseUnit', () => {
  it('treats SACK as an alias of BAG', () => {
    expect(normaliseUnit('SACK')).toBe('BAG');
    expect(normaliseUnit('sack')).toBe('BAG');
  });
  it('uppercases and trims', () => {
    expect(normaliseUnit('  kg ')).toBe('KG');
  });
  it('defaults empty to PCS', () => {
    expect(normaliseUnit(null)).toBe('PCS');
    expect(normaliseUnit('')).toBe('PCS');
  });
});

describe('configured items use their own factor', () => {
  it('BAG → KG at 30 kg/bag, NOT the legacy 25', () => {
    const r = resolveConversion(bagItem(30), 10, 'BAG');
    expect(r.quantity).toBe(300);
    expect(r.factor).toBe(30);
    expect(r.factorSource).toBe('ITEM');
  });

  it('a configured 25 is still reported as ITEM, not LEGACY_DEFAULT', () => {
    // Same number, different provenance — the distinction is the point.
    const r = resolveConversion(bagItem(25), 4, 'BAG');
    expect(r.quantity).toBe(100);
    expect(r.factorSource).toBe('ITEM');
  });

  it('accepts a Decimal-like string from Prisma', () => {
    const r = resolveConversion(bagItem('12.5'), 4, 'BAG');
    expect(r.quantity).toBe(50);
    expect(r.factorSource).toBe('ITEM');
  });

  it('KG → BAG inverts the item factor', () => {
    const r = resolveConversion(bagItem(30, 'BAG'), 300, 'KG');
    expect(r.quantity).toBe(10);
    expect(r.factor).toBeCloseTo(1 / 30, 12);
    expect(r.factorSource).toBe('ITEM');
  });

  it('CTN → PCS uses packsPerCarton', () => {
    const r = resolveConversion({ unit: 'PCS', packsPerCarton: 12 }, 3, 'CTN');
    expect(r.quantity).toBe(36);
    expect(r.factor).toBe(12);
    expect(r.factorSource).toBe('ITEM');
  });
});

describe('unconfigured items fall back, but are flagged', () => {
  it.each([null, undefined, 0, '', '0'])(
    'bagWeightKg=%p falls back to the legacy constant and says so',
    (v) => {
      const r = resolveConversion(bagItem(v), 10, 'BAG');
      expect(r.quantity).toBe(10 * LEGACY_BAG_KG);
      expect(r.factor).toBe(LEGACY_BAG_KG);
      expect(r.factorSource).toBe('LEGACY_DEFAULT');
    },
  );

  it('a negative bagWeightKg is treated as unconfigured, not honoured', () => {
    const r = resolveConversion(bagItem(-5), 2, 'BAG');
    expect(r.factor).toBe(LEGACY_BAG_KG);
    expect(r.factorSource).toBe('LEGACY_DEFAULT');
  });

  it('the fallback reproduces the exact behaviour it replaces (bags × 25)', () => {
    // Regression guard: switching the live path to this resolver must not
    // change any quantity for today's data, where no item is configured.
    for (const bags of [1, 4, 10, 37]) {
      expect(resolveConversion(bagItem(null), bags, 'BAG').quantity).toBe(bags * 25);
    }
  });

  it('CTN → PCS has NO fallback — there is no defensible global default', () => {
    expect(() =>
      resolveConversion({ unit: 'PCS', packsPerCarton: null }, 3, 'CTN'),
    ).toThrow(/packsPerCarton/);
  });
});

describe('identity and physical constants', () => {
  it('same unit is factor 1, IDENTITY', () => {
    const r = resolveConversion({ unit: 'KG' }, 42, 'KG');
    expect(r).toEqual({ quantity: 42, factor: 1, factorSource: 'IDENTITY' });
  });

  it('SACK on a BAG item is identity, not a conversion', () => {
    const r = resolveConversion({ unit: 'BAG' }, 5, 'SACK');
    expect(r.factorSource).toBe('IDENTITY');
    expect(r.quantity).toBe(5);
  });

  it('G → KG is PHYSICAL — not configurable, cannot drift', () => {
    const r = resolveConversion({ unit: 'KG' }, 500, 'G');
    expect(r.quantity).toBe(0.5);
    expect(r.factorSource).toBe('PHYSICAL');
  });

  it('KG → G is PHYSICAL', () => {
    const r = resolveConversion({ unit: 'G' }, 2, 'KG');
    expect(r.quantity).toBe(2000);
    expect(r.factorSource).toBe('PHYSICAL');
  });
});

describe('the stored factor makes a row reproducible', () => {
  it('quantity === input × factor for every supported pair', () => {
    const cases: Array<[any, number, string]> = [
      [bagItem(30), 10, 'BAG'],
      [bagItem(null), 10, 'BAG'],
      [{ unit: 'KG' }, 500, 'G'],
      [{ unit: 'G' }, 2, 'KG'],
      [{ unit: 'PCS', packsPerCarton: 12 }, 3, 'CTN'],
      [{ unit: 'CTN', packsPerCarton: 12 }, 36, 'PCS'],
      [{ unit: 'KG' }, 7, 'KG'],
    ];
    for (const [item, qty, from] of cases) {
      const r = resolveConversion(item, qty, from);
      expect(r.quantity).toBeCloseTo(qty * r.factor, 9);
    }
  });
});

describe('invalid input is refused', () => {
  it.each([-1, NaN, Infinity])('rejects qty=%p', (q) => {
    expect(() => resolveConversion(bagItem(25), q as number, 'BAG')).toThrow();
  });

  it('refuses an unsupported pair rather than guessing', () => {
    expect(() => resolveConversion({ unit: 'ROLL' }, 5, 'KG')).toThrow(/تحويل غير مدعوم/);
  });
});
