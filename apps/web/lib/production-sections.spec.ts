/**
 * Regression tests for productionSectionOf / splitItemsBySection.
 *
 * These lock in the invariant that motivated the fix:
 *   An inventory item that clearly belongs in a production section
 *   (has POWDER_BULK type, or PACKAGING+CTN, or PACKAGING+ROLL, etc.)
 *   MUST show up in that section's dropdown regardless of what the
 *   SKU or Arabic name happens to be.
 *
 * The prior FE code excluded every item whose SKU/name didn't match
 * hardcoded strings ('CTN…', 'ALU…', 'RAW-MILK…', 'كرتون', 'ألمنيوم',
 * 'حليب خام'). If this file's tests break, that bug is at risk of
 * re-emerging.
 */

import { productionSectionOf, splitItemsBySection } from './production-sections';

describe('productionSectionOf — SCHEMA-driven categorisation', () => {
  // ── The bug the user actually reported ───────────────────────────
  it('a PACKAGING carton with SKU "INV-042" and name "علبة كرتون كبيرة" is still a carton', () => {
    expect(
      productionSectionOf({ type: 'PACKAGING', unit: 'CTN', sku: 'INV-042', name: 'علبة كرتون كبيرة' }),
    ).toBe('carton');
  });

  it('a POWDER_BULK milk with SKU "WH-A-15" and name "حليب مسحوق" appears under raw milk', () => {
    expect(
      productionSectionOf({ type: 'POWDER_BULK', unit: 'BAG', sku: 'WH-A-15', name: 'حليب مسحوق' }),
    ).toBe('raw_milk');
  });

  it('a PACKAGING aluminum ROLL with a Latin name still lands in aluminum', () => {
    expect(
      productionSectionOf({ type: 'PACKAGING', unit: 'ROLL', sku: 'X-1', name: 'Aluminium 8mic' }),
    ).toBe('aluminum');
  });

  // ── Enum mapping ─────────────────────────────────────────────────
  it('POWDER_RETAIL → finished', () => {
    expect(
      productionSectionOf({ type: 'POWDER_RETAIL', name: 'حليب انجوي جاهز 750 غم' }),
    ).toBe('finished');
  });

  it('POWDER_BULK → raw_milk regardless of unit', () => {
    for (const unit of ['KG', 'G', 'BAG', 'PCS']) {
      expect(productionSectionOf({ type: 'POWDER_BULK', unit })).toBe('raw_milk');
    }
  });

  // ── PACKAGING + unit split ───────────────────────────────────────
  it('PACKAGING + CTN unit → carton (regardless of name)', () => {
    expect(productionSectionOf({ type: 'PACKAGING', unit: 'CTN', name: 'anything' })).toBe('carton');
  });

  it('PACKAGING + ROLL unit → aluminum', () => {
    expect(productionSectionOf({ type: 'PACKAGING', unit: 'ROLL', name: 'x' })).toBe('aluminum');
  });

  // ── Category fallback ────────────────────────────────────────────
  it('ambiguous PACKAGING with category="ألمنيوم" → aluminum', () => {
    expect(
      productionSectionOf({ type: 'PACKAGING', unit: 'KG', category: 'ألمنيوم', name: '' }),
    ).toBe('aluminum');
  });

  it('ambiguous PACKAGING with category="carton" → carton', () => {
    expect(
      productionSectionOf({ type: 'PACKAGING', unit: 'PCS', category: 'carton' }),
    ).toBe('carton');
  });

  // ── Legacy keyword fallback ──────────────────────────────────────
  it('no type set — Arabic كرتون in name still routes to carton', () => {
    expect(productionSectionOf({ name: 'كرتون حليب 500مل', sku: 'X' })).toBe('carton');
  });

  it('no type set — English "raw milk" in name still routes to raw_milk', () => {
    expect(productionSectionOf({ name: 'raw milk powder', sku: 'MP-1' })).toBe('raw_milk');
  });

  it('a name mentioning multiple materials picks the MOST specific match first (aluminum > raw_milk > carton)', () => {
    // "غطاء كرتون ألمنيوم" — this cap really is aluminum. The current
    // ordering ensures aluminum wins over carton, so the user classifies
    // it under Aluminum, which is the correct production-section.
    expect(
      productionSectionOf({ name: 'غطاء كرتون ألمنيوم', sku: 'X' }),
    ).toBe('aluminum');
  });

  // ── Non-production items ─────────────────────────────────────────
  it('CONSUMABLE without hints → null (does not show anywhere)', () => {
    expect(productionSectionOf({ type: 'CONSUMABLE', name: 'مادة تنظيف' })).toBeNull();
  });

  it('inactive item never shows even if it would otherwise match', () => {
    expect(
      productionSectionOf({ type: 'POWDER_BULK', name: 'حليب خام', active: false }),
    ).toBeNull();
  });

  it('null / undefined item → null (safe against bad data)', () => {
    expect(productionSectionOf(null)).toBeNull();
    expect(productionSectionOf(undefined)).toBeNull();
  });
});

describe('splitItemsBySection — the shape the production page consumes', () => {
  it('splits a mixed inventory list into every section in one pass', () => {
    const items = [
      { id: 1, type: 'POWDER_BULK', unit: 'BAG', name: 'حليب خام كامل', sku: 'MP-01' },
      { id: 2, type: 'PACKAGING', unit: 'CTN', name: 'علبة كرتون كبيرة', sku: 'INV-042' },
      { id: 3, type: 'PACKAGING', unit: 'ROLL', name: 'رول ألمنيوم', sku: 'INV-050' },
      { id: 4, type: 'POWDER_RETAIL', unit: 'PCS', name: 'حليب انجوي 750غ', sku: 'FIN-1' },
      { id: 5, type: 'CONSUMABLE', unit: 'PCS', name: 'قفازات', sku: 'C-1' },
    ];
    const s = splitItemsBySection(items);
    expect(s.raw_milk.map((x: any) => x.id)).toEqual([1]);
    expect(s.carton.map((x: any) => x.id)).toEqual([2]);
    expect(s.aluminum.map((x: any) => x.id)).toEqual([3]);
    expect(s.finished.map((x: any) => x.id)).toEqual([4]);
    expect(s.uncategorized.map((x: any) => x.id)).toEqual([5]);
  });

  it('handles null / empty input safely', () => {
    expect(splitItemsBySection(null).raw_milk).toEqual([]);
    expect(splitItemsBySection(undefined).carton).toEqual([]);
    expect(splitItemsBySection([]).aluminum).toEqual([]);
  });

  it('an item lives in EXACTLY one section — never duplicated', () => {
    // Cross-check: total items in / out matches.
    const items = [
      { type: 'POWDER_BULK', unit: 'BAG' },
      { type: 'PACKAGING', unit: 'CTN' },
      { type: 'PACKAGING', unit: 'ROLL' },
      { type: 'POWDER_RETAIL' },
      { type: 'CONSUMABLE' },
    ];
    const s = splitItemsBySection(items);
    const total =
      s.raw_milk.length + s.carton.length + s.aluminum.length +
      s.finished.length + s.uncategorized.length;
    expect(total).toBe(items.length);
  });
});
