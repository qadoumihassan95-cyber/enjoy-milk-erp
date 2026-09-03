/**
 * Item classification (ItemType) — create, edit, and every transition.
 *
 * DOMAIN FACT THIS RESTS ON
 * -------------------------
 * No historical table stores ItemType. StockMovement, PurchaseBatch, every
 * Production* table, ProductionCostAllocation, SaleCostAllocation,
 * PackagingFormula and PackagingFormulaItem all reference the Item by ID and
 * denormalise name/quantity only — never the type. A reclassification is
 * therefore structurally incapable of rewriting history, which is why every
 * transition below is safe.
 *
 * The customer's three concepts map onto four enum values: "مواد إنتاج" is
 * BOTH POWDER_BULK (raw ingredients) and PACKAGING (cartons/rolls), because
 * the production selectors route them to different sections. Both are kept.
 */

import {
  InventoryService,
  ITEM_TYPES,
  assertValidItemType,
} from './inventory.service';

function makeDb(initialType = 'CONSUMABLE') {
  const state = {
    items: [
      { id: 'i-1', tenantId: 't1', sku: 'SKU-1', name: 'صنف', active: true, type: initialType, unit: 'PCS', stockLevels: [] },
      { id: 'i-arch', tenantId: 't1', sku: 'SKU-A', name: 'مؤرشف', active: false, type: 'POWDER_BULK', unit: 'PCS', stockLevels: [] },
      { id: 'i-other', tenantId: 't2', sku: 'SKU-X', name: 'آخر', active: true, type: 'CONSUMABLE', unit: 'PCS', stockLevels: [] },
    ] as any[],
    stockMovements: [] as any[],
    purchaseBatches: [{ id: 'pb-1', itemId: 'i-1', remaining: 100, unitCost: 5 }] as any[],
    stockLevels: [{ id: 'sl-1', itemId: 'i-1', quantity: 100 }] as any[],
  };
  const match = (i: any, w: any): boolean => {
    if (w.tenantId && i.tenantId !== w.tenantId) return false;
    if (w.id && i.id !== w.id) return false;
    if (w.NOT?.id && i.id === w.NOT.id) return false;
    if (w.sku && i.sku !== w.sku) return false;
    if (w.OR) {
      // createItem checks name / sku / barcode duplicates via OR.
      return w.OR.some((c: any) =>
        (c.name !== undefined && i.name === c.name) ||
        (c.sku !== undefined && i.sku === c.sku) ||
        (c.barcode !== undefined && i.barcode === c.barcode),
      );
    }
    return true;
  };
  const client: any = {
    item: {
      findFirst: async ({ where }: any) => state.items.find((i) => match(i, where)) ?? null,
      findMany: async ({ where }: any) => state.items.filter((i) => match(i, where)),
      update: async ({ where, data }: any) => {
        const it = state.items.find((i) => i.id === where.id);
        for (const [k, v] of Object.entries(data)) if (v !== undefined) (it as any)[k] = v;
        return it;
      },
      create: async ({ data }: any) => { const it = { id: 'i-new', stockLevels: [], ...data }; state.items.push(it); return it; },
    },
    stockMovement: { count: async () => state.stockMovements.length },
  };
  const audits: any[] = [];
  return { state, audits, svc: new InventoryService(client, { log: async (e: any) => { audits.push(e); } } as any) as any };
}

describe('ItemType enum contract', () => {
  it('exposes exactly the four schema values', () => {
    expect([...ITEM_TYPES]).toEqual(['POWDER_BULK', 'PACKAGING', 'POWDER_RETAIL', 'CONSUMABLE']);
  });

  it('accepts each valid value and normalises case', () => {
    for (const t of ITEM_TYPES) expect(assertValidItemType(t)).toBe(t);
    expect(assertValidItemType('powder_bulk')).toBe('POWDER_BULK');
  });

  it('rejects anything else with a controlled error, not a Prisma crash', () => {
    for (const bad of ['RAW', 'FINISHED', '', null, undefined, 42, 'DROP TABLE']) {
      let err: any;
      try { assertValidItemType(bad as any); } catch (e) { err = e; }
      expect(err).toBeDefined();
      const r = err.getResponse();
      expect(r.code).toBe('INVALID_ITEM_TYPE');
      expect(typeof r.message).toBe('string');
    }
  });
});

describe('create with each classification', () => {
  it.each([...ITEM_TYPES])('creates an item as %s', async (type) => {
    const { svc } = makeDb();
    const out = await svc.createItem('t1', { name: 'ن ' + type, sku: 'S-' + type, type });
    expect(out.type).toBe(type);
  });

  it('defaults to CONSUMABLE when omitted', async () => {
    const { svc } = makeDb();
    const out = await svc.createItem('t1', { name: 'بدون نوع', sku: 'S-NONE' });
    expect(out.type).toBe('CONSUMABLE');
  });

  it('rejects an invalid type on create', async () => {
    const { svc } = makeDb();
    await expect(svc.createItem('t1', { name: 'x', sku: 'S-BAD', type: 'NOT_A_TYPE' })).rejects.toThrow();
  });
});

describe('transition matrix — all six directions', () => {
  const pairs: Array<[string, string]> = [
    ['CONSUMABLE', 'POWDER_BULK'], ['CONSUMABLE', 'PACKAGING'], ['CONSUMABLE', 'POWDER_RETAIL'],
    ['POWDER_BULK', 'CONSUMABLE'], ['POWDER_BULK', 'POWDER_RETAIL'], ['POWDER_BULK', 'PACKAGING'],
    ['PACKAGING', 'CONSUMABLE'], ['PACKAGING', 'POWDER_RETAIL'], ['PACKAGING', 'POWDER_BULK'],
    ['POWDER_RETAIL', 'CONSUMABLE'], ['POWDER_RETAIL', 'POWDER_BULK'], ['POWDER_RETAIL', 'PACKAGING'],
  ];

  it.each(pairs)('%s → %s is allowed and preserves identity', async (from, to) => {
    const { svc, state } = makeDb(from);
    const before = { ...state.items[0] };
    const out = await svc.updateItem('t1', 'i-1', { type: to });
    expect(out.type).toBe(to);
    expect(out.id).toBe(before.id);      // Item ID preserved
    expect(out.sku).toBe(before.sku);    // SKU preserved
    expect(out.active).toBe(before.active);
  });

  it.each(pairs)('%s → %s touches no stock, FIFO or movements', async (from, to) => {
    const { svc, state } = makeDb(from);
    const stockBefore = JSON.stringify(state.stockLevels);
    const fifoBefore = JSON.stringify(state.purchaseBatches);
    await svc.updateItem('t1', 'i-1', { type: to });
    expect(JSON.stringify(state.stockLevels)).toBe(stockBefore);     // quantity unchanged
    expect(JSON.stringify(state.purchaseBatches)).toBe(fifoBefore);  // FIFO layers unchanged
    expect(state.stockMovements).toHaveLength(0);                    // no movement generated
    expect(state.items).toHaveLength(3);                             // no item recreated
  });
});

describe('archived items', () => {
  it('classification can be changed while archived', async () => {
    const { svc } = makeDb();
    const out = await svc.updateItem('t1', 'i-arch', { type: 'POWDER_RETAIL' });
    expect(out.type).toBe('POWDER_RETAIL');
    expect(out.active).toBe(false); // still archived
    expect(out.id).toBe('i-arch');
  });

  it('changing type with active:true smuggled in does NOT restore it', async () => {
    const { svc } = makeDb();
    const out = await svc.updateItem('t1', 'i-arch', { type: 'CONSUMABLE', active: true });
    expect(out.type).toBe('CONSUMABLE');
    expect(out.active).toBe(false);
  });
});

describe('validation, audit and isolation', () => {
  it('rejects an invalid type on update before writing anything', async () => {
    const { svc, state } = makeDb('CONSUMABLE');
    await expect(svc.updateItem('t1', 'i-1', { type: 'FINISHED_GOOD' })).rejects.toThrow();
    expect(state.items[0].type).toBe('CONSUMABLE'); // unchanged
  });

  it('records before/after type in the ITEM_UPDATED audit entry', async () => {
    const { svc, audits } = makeDb('POWDER_BULK');
    await svc.updateItem('t1', 'i-1', { type: 'POWDER_RETAIL' }, 'user-9');
    const e = audits.find((a) => a.action === 'ITEM_UPDATED');
    expect(e.before.type).toBe('POWDER_BULK');
    expect(e.after.type).toBe('POWDER_RETAIL');
    expect(e.actorUserId).toBe('user-9');
  });

  it('cannot reclassify an item in another tenant', async () => {
    const { svc } = makeDb();
    await expect(svc.updateItem('t1', 'i-other', { type: 'PACKAGING' })).rejects.toThrow();
  });

  it('leaves type untouched when the field is not sent', async () => {
    const { svc } = makeDb('PACKAGING');
    const out = await svc.updateItem('t1', 'i-1', { name: 'اسم فقط' });
    expect(out.type).toBe('PACKAGING');
  });
});
