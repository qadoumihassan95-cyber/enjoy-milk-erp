/**
 * R4 — the operator measures waste in KILOGRAMS, inventory is kept in SACKS.
 *
 * This file drives the REAL DailyProductionService against an in-memory
 * Prisma double, because the bug it exists to prevent lives in the round
 * trip, not in any single function:
 *
 *   operator types 5 KG  →  saveAll  →  DB  →  reload  →  screen
 *
 * The previous build canonicalised on the way in (5 KG became 0.2 BAG,
 * because BAG is the item's inventory unit) and every reader afterwards
 * called that number kilograms. A 5 kg loss on a 1,525 kg run was reported
 * as 0.20 كغم — a 25× understatement — and the operator had no way to see
 * it, because the screen looked right until the page was reloaded.
 *
 * The rule these tests lock in: issued-material waste is a MEASUREMENT and
 * is stored exactly as measured. It is safe to store a measurement in its
 * own unit precisely because it never moves stock. Waste that DOES move
 * stock is still canonicalised — so the fix cannot be "stop converting".
 */

import { DailyProductionService } from './daily-production.service';

type Row = Record<string, any>;

const MILK = 'itm-milk';
const CARTON = 'itm-carton';
const FINISHED = 'itm-finished';
const STRAY = 'itm-stray';

const OPENING_MILK = 39247;

function makeDb(opts: { mode?: string } = {}) {
  const state = {
    seq: 0,
    tenantSettings: [
      { id: 'ts', tenantId: 't1', productionPostingMode: opts.mode ?? 'STRICT_MODE' },
    ] as Row[],
    warehouses: [{ id: 'wh-main', tenantId: 't1', code: 'MAIN', active: true }] as Row[],
    items: [
      { id: MILK, tenantId: 't1', name: 'حليب خام', unit: 'BAG', bagWeightKg: 25, avgCost: 1, costPrice: 1 },
      { id: CARTON, tenantId: 't1', name: 'كرتون 750 غم', unit: 'PCS', bagWeightKg: null, avgCost: 0.1, costPrice: 0.1 },
      { id: FINISHED, tenantId: 't1', name: 'حليب جاهز 750 غم', unit: 'PCS', bagWeightKg: null, avgCost: 1, costPrice: 1 },
      { id: STRAY, tenantId: 't1', name: 'صنف مخزني آخر', unit: 'PCS', bagWeightKg: null, avgCost: 1, costPrice: 1 },
    ] as Row[],
    stockLevels: [
      { id: 'sl-milk', tenantId: 't1', itemId: MILK, warehouseId: 'wh-main', batchId: null, quantity: OPENING_MILK },
      { id: 'sl-carton', tenantId: 't1', itemId: CARTON, warehouseId: 'wh-main', batchId: null, quantity: 5000 },
      { id: 'sl-fin', tenantId: 't1', itemId: FINISHED, warehouseId: 'wh-main', batchId: null, quantity: 100 },
      { id: 'sl-stray', tenantId: 't1', itemId: STRAY, warehouseId: 'wh-main', batchId: null, quantity: 50 },
    ] as Row[],
    purchaseBatches: [
      { id: 'pb-milk', tenantId: 't1', itemId: MILK, purchaseDate: new Date('2026-01-01'), createdAt: new Date('2026-01-01'), quantity: OPENING_MILK, remaining: OPENING_MILK, unitCost: 1, sourceType: 'OPENING_BALANCE' },
      { id: 'pb-carton', tenantId: 't1', itemId: CARTON, purchaseDate: new Date('2026-01-01'), createdAt: new Date('2026-01-01'), quantity: 5000, remaining: 5000, unitCost: 0.1, sourceType: 'OPENING_BALANCE' },
      { id: 'pb-fin', tenantId: 't1', itemId: FINISHED, purchaseDate: new Date('2026-01-01'), createdAt: new Date('2026-01-01'), quantity: 100, remaining: 100, unitCost: 1, sourceType: 'OPENING_BALANCE' },
      { id: 'pb-stray', tenantId: 't1', itemId: STRAY, purchaseDate: new Date('2026-01-01'), createdAt: new Date('2026-01-01'), quantity: 50, remaining: 50, unitCost: 1, sourceType: 'OPENING_BALANCE' },
    ] as Row[],
    stockMovements: [] as Row[],
    productionStockAudits: [] as Row[],
    productionCostAllocations: [] as Row[],
    dailyProductions: [{ id: 'dp-1', tenantId: 't1', status: 'DRAFT', shift: null, operatorName: null, machineNumber: null, notes: null }] as Row[],
    cartonUsage: [] as Row[],
    aluminumUsage: [] as Row[],
    milkUsage: [] as Row[],
    produced: [] as Row[],
    wastages: [] as Row[],
  };

  const matches = (r: Row, where: Row = {}) =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        if ('in' in (v as any)) return (v as any).in.includes(r[k]);
        return true; // unsupported operator — treat as satisfied
      }
      return (r[k] ?? null) === (v ?? null);
    });

  const table = (rows: Row[]) => ({
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null,
    findUnique: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where)),
    create: async ({ data }: any) => {
      const row = { id: `r${++state.seq}`, ...data };
      rows.push(row);
      return row;
    },
    createMany: async ({ data }: any) => {
      for (const d of data) rows.push({ id: `r${++state.seq}`, ...d });
      return { count: data.length };
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
    upsert: async ({ where, create, update }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (row) { Object.assign(row, update); return row; }
      const made = { id: `r${++state.seq}`, ...create };
      rows.push(made);
      return made;
    },
    aggregate: async ({ where, _sum }: any) => {
      const hit = rows.filter((r) => matches(r, where));
      const out: Record<string, number> = {};
      for (const f of Object.keys(_sum ?? { quantity: true })) {
        out[f] = hit.reduce((a, r) => a + Number(r[f] ?? 0), 0);
      }
      return { _sum: out };
    },
    deleteMany: async ({ where }: any = {}) => {
      const keep = rows.filter((r) => !matches(r, where));
      const n = rows.length - keep.length;
      rows.length = 0;
      rows.push(...keep);
      return { count: n };
    },
  });

  const client: any = {
    tenantSetting: table(state.tenantSettings),
    warehouse: table(state.warehouses),
    item: table(state.items),
    stockLevel: table(state.stockLevels),
    stockMovement: table(state.stockMovements),
    purchaseBatch: table(state.purchaseBatches),
    productionStockAudit: table(state.productionStockAudits),
    productionCostAllocation: table(state.productionCostAllocations),
    productionCartonUsage: table(state.cartonUsage),
    productionAluminumUsage: table(state.aluminumUsage),
    productionMilkUsage: table(state.milkUsage),
    productionProducedItem: table(state.produced),
    productionWaste: table(state.wastages),
  };

  // The sheet, assembled from the child tables — so a save is genuinely
  // read back the way a page reload reads it.
  const hydrate = (dp: Row) => ({
    ...dp,
    cartonUsage: state.cartonUsage.filter((r) => r.dailyProductionId === dp.id),
    aluminumUsage: state.aluminumUsage.filter((r) => r.dailyProductionId === dp.id),
    milkUsage: state.milkUsage.filter((r) => r.dailyProductionId === dp.id),
    produced: state.produced.filter((r) => r.dailyProductionId === dp.id),
    wastages: state.wastages.filter((r) => r.dailyProductionId === dp.id),
  });
  const dpTable = table(state.dailyProductions);
  client.dailyProduction = {
    ...dpTable,
    findFirst: async ({ where, include }: any = {}) => {
      const dp = state.dailyProductions.find((r) => matches(r, where));
      if (!dp) return null;
      return include ? hydrate(dp) : dp;
    },
    findUnique: async ({ where, include }: any) => {
      const dp = state.dailyProductions.find((r) => matches(r, where));
      if (!dp) return null;
      return include ? hydrate(dp) : dp;
    },
  };
  client.$transaction = async (fn: any) => fn(client);

  // Real-enough FIFO: records what was consumed so the test can assert the
  // exact quantity, and decrements remaining like the real service does.
  const fifo = {
    consumed: [] as Array<{ itemId: string; qty: number; method: string }>,
    consumeForProduction: jest.fn(async (_t: string, o: any) => {
      fifo.consumed.push({
        itemId: o.rawItemId,
        qty: o.quantity,
        method: o.allocationMethod ?? 'FIFO',
      });
      const b = state.purchaseBatches.find((x) => x.itemId === o.rawItemId && Number(x.remaining) > 0);
      if (b) b.remaining = Number(b.remaining) - o.quantity;
      return { totalCost: o.quantity, allocations: [], quantityConsumed: o.quantity, shortageQuantity: 0 };
    }),
    reverseForProduction: jest.fn(async () => ({ restoredAllocations: 0 })),
  };

  return { state, client, fifo };
}

const svcFor = (db: ReturnType<typeof makeDb>) =>
  new DailyProductionService(db.client as any, db.fifo as any);

const stockOf = (db: ReturnType<typeof makeDb>, itemId: string) =>
  Number(db.state.stockLevels.find((s) => s.itemId === itemId)!.quantity);

/** The real sheet: 61 sacks of milk, 120 cartons, 5 kg of milk lost. */
const SHEET = {
  cartonUsage: [{ itemId: CARTON, itemName: 'كرتون 750 غم', quantity: 120, unit: 'PCS' }],
  milkUsage: [{ itemId: MILK, itemName: 'حليب خام', count: 61, quantity: 1525, unit: 'KG' }],
  produced: [{ itemId: FINISHED, itemName: 'حليب جاهز 750 غم', cartonsTotal: 120 }],
  wastages: [{ itemId: MILK, itemName: 'حليب خام', quantity: 5, unit: 'KG' }],
};

// ═══════════════════════════════════════════════════════════════════
describe('R4 storage — 5 KG of raw-milk waste survives save/reload', () => {
  it('persists quantity = 5 and unit = KG, NOT 0.2 BAG and NOT 125 KG', async () => {
    const db = makeDb();
    await svcFor(db).saveAll('t1', 'dp-1', SHEET as any);

    expect(db.state.wastages).toHaveLength(1);
    const w = db.state.wastages[0];
    expect(Number(w.quantity)).toBe(5);
    expect(w.unit).toBe('KG');
    expect(Number(w.quantity)).not.toBe(0.2);
    expect(Number(w.quantity)).not.toBe(125);
  });

  it('snapshots the sack weight on the row, so a later bagWeightKg edit cannot rewrite history', async () => {
    const db = makeDb();
    await svcFor(db).saveAll('t1', 'dp-1', SHEET as any);
    const w = db.state.wastages[0];

    // One measured KG is 1/25 of a sack. The reciprocal recovers the
    // 25 kg/sack that was in force when the row was written.
    expect(Number(w.unitFactor)).toBeCloseTo(0.04, 6);
    expect(1 / Number(w.unitFactor)).toBeCloseTo(25, 6);
    expect(w.factorSource).toBe('ITEM');

    // Reconfiguring the item afterwards must not touch the stored row.
    db.state.items.find((i) => i.id === MILK)!.bagWeightKg = 30;
    expect(Number(db.state.wastages[0].quantity)).toBe(5);
    expect(Number(db.state.wastages[0].unitFactor)).toBeCloseTo(0.04, 6);
  });

  it('reloads through get() with the same numbers the operator typed', async () => {
    const db = makeDb();
    const svc = svcFor(db);
    await svc.saveAll('t1', 'dp-1', SHEET as any);

    const reloaded: any = await svc.get('t1', 'dp-1');
    expect(Number(reloaded.milkUsage[0].count)).toBe(61);
    expect(Number(reloaded.milkUsage[0].quantity)).toBe(61); // canonical: sacks
    expect(reloaded.milkUsage[0].unit).toBe('BAG');
    expect(Number(reloaded.wastages[0].quantity)).toBe(5);
    expect(reloaded.wastages[0].unit).toBe('KG');
  });

  it('accepts a decimal kilogram value', async () => {
    const db = makeDb();
    await svcFor(db).saveAll('t1', 'dp-1', {
      ...SHEET,
      wastages: [{ itemId: MILK, itemName: 'حليب خام', quantity: 5.5, unit: 'KG' }],
    } as any);
    expect(Number(db.state.wastages[0].quantity)).toBe(5.5);
    expect(db.state.wastages[0].unit).toBe('KG');
  });

  it('rejects a malformed waste number instead of writing Decimal(NaN)', async () => {
    const db = makeDb();
    await expect(
      svcFor(db).saveAll('t1', 'dp-1', {
        ...SHEET,
        wastages: [{ itemId: MILK, itemName: 'حليب خام', quantity: 'abc' as any, unit: 'KG' }],
      } as any),
    ).rejects.toThrow(/كمية توالف غير صالحة/);
  });

  it('rejects a negative waste number at save time', async () => {
    const db = makeDb();
    await expect(
      svcFor(db).saveAll('t1', 'dp-1', {
        ...SHEET,
        wastages: [{ itemId: MILK, itemName: 'حليب خام', quantity: -1, unit: 'KG' }],
      } as any),
    ).rejects.toThrow(/كمية توالف غير صالحة/);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('R4 storage — waste that DOES move stock is still canonicalised', () => {
  it('finished-good waste is converted into the item unit', async () => {
    const db = makeDb();
    await svcFor(db).saveAll('t1', 'dp-1', {
      ...SHEET,
      wastages: [{ itemId: FINISHED, itemName: 'حليب جاهز 750 غم', quantity: 7, unit: 'PCS' }],
    } as any);
    const w = db.state.wastages[0];
    expect(w.unit).toBe('PCS');           // the item's own unit
    expect(Number(w.quantity)).toBe(7);
    expect(w.factorSource).toBe('IDENTITY');
  });

  it('an independent warehouse loss measured in KG on a BAG item is still converted to sacks', async () => {
    const db = makeDb();
    // Milk is NOT issued on this sheet, so its waste is a real stock loss.
    await svcFor(db).saveAll('t1', 'dp-1', {
      cartonUsage: [{ itemId: CARTON, itemName: 'كرتون 750 غم', quantity: 10, unit: 'PCS' }],
      produced: [],
      wastages: [{ itemId: MILK, itemName: 'حليب خام', quantity: 50, unit: 'KG' }],
    } as any);
    const w = db.state.wastages[0];
    expect(w.unit).toBe('BAG');
    expect(Number(w.quantity)).toBe(2);   // 50 kg ÷ 25 = 2 sacks
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('posting the real sheet — 39,247 → 39,186', () => {
  const postSheet = async (db: ReturnType<typeof makeDb>) => {
    const svc = svcFor(db);
    await svc.saveAll('t1', 'dp-1', SHEET as any);
    return svc.post('t1', 'u1', 'dp-1');
  };

  it('deducts exactly 61 sacks — not 66, not 61.2', async () => {
    const db = makeDb();
    const res: any = await postSheet(db);
    expect(res.success).toBe(true);
    expect(stockOf(db, MILK)).toBe(39186);
    expect(stockOf(db, MILK)).not.toBe(39247 - 66);
    expect(stockOf(db, MILK)).not.toBe(39247 - 61.2);
  });

  it('writes ONE raw-milk movement, OUT 61, and no WASTE movement', async () => {
    const db = makeDb();
    await postSheet(db);
    const milkMoves = db.state.stockMovements.filter((m) => m.itemId === MILK);
    expect(milkMoves).toHaveLength(1);
    expect(milkMoves[0].type).toBe('OUT');
    expect(milkMoves[0].reasonCode).toBe('PROD_MILK');
    expect(Number(milkMoves[0].quantity)).toBe(61);
    expect(db.state.stockMovements.some((m) => m.itemId === MILK && m.type === 'WASTE')).toBe(false);
  });

  it('consumes FIFO exactly once for 61 sacks — never a FIFO_WASTE_RAW of 5', async () => {
    const db = makeDb();
    await postSheet(db);
    const milkFifo = db.fifo.consumed.filter((c) => c.itemId === MILK);
    expect(milkFifo).toHaveLength(1);
    expect(milkFifo[0].qty).toBe(61);
    expect(milkFifo[0].method).toBe('FIFO');
    expect(db.fifo.consumed.some((c) => c.method === 'FIFO_WASTE_RAW')).toBe(false);
    expect(Number(db.state.purchaseBatches.find((b) => b.id === 'pb-milk')!.remaining)).toBe(OPENING_MILK - 61);
  });

  it('records the loss on the audit trail without moving stock', async () => {
    const db = makeDb();
    await postSheet(db);
    const audit = db.state.productionStockAudits.find((a) => a.section === 'توالف (ضمن المصروف)');
    expect(audit).toBeDefined();
    expect(Number(audit!.quantityRequested)).toBe(5); // the measured KG
  });

  it('STRICT_MODE does not see a phantom shortage from the KG waste row', async () => {
    // 61 sacks issued + 5 counted as sacks would have demanded 66 and, with
    // a tight opening balance, refused a valid sheet outright.
    const db = makeDb({ mode: 'STRICT_MODE' });
    db.state.stockLevels.find((s) => s.itemId === MILK)!.quantity = 61;
    db.state.purchaseBatches.find((b) => b.id === 'pb-milk')!.remaining = 61;
    const res: any = await postSheet(db);
    expect(res.success).toBe(true);
    expect(stockOf(db, MILK)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('server-side mass-balance gate — the web screen is not the control', () => {
  const postWaste = async (qty: any, unit = 'KG', mode = 'STRICT_MODE') => {
    const db = makeDb({ mode });
    const svc = svcFor(db);
    await svc.saveAll('t1', 'dp-1', {
      ...SHEET,
      wastages: qty === null ? [] : [{ itemId: MILK, itemName: 'حليب خام', quantity: qty, unit }],
    } as any);
    return { db, run: () => svc.post('t1', 'u1', 'dp-1') };
  };

  it('accepts 5 kg against a 1,525 kg gross', async () => {
    const { run } = await postWaste(5);
    await expect(run()).resolves.toMatchObject({ success: true });
  });

  it('accepts zero waste — a clean run must still post', async () => {
    const { run } = await postWaste(0);
    await expect(run()).resolves.toMatchObject({ success: true });
  });

  it('accepts waste exactly equal to the gross weight', async () => {
    const { run } = await postWaste(1525);
    await expect(run()).resolves.toMatchObject({ success: true });
  });

  it('REJECTS 1,526 kg — one kilogram more than was issued', async () => {
    const { db, run } = await postWaste(1526);
    await expect(run()).rejects.toThrow(/أكبر من إجمالي/);
    // and nothing was written
    expect(stockOf(db, MILK)).toBe(OPENING_MILK);
    expect(db.state.stockMovements).toHaveLength(0);
    expect(db.state.dailyProductions[0].status).toBe('DRAFT');
  });

  it('REJECTS a unit with no weight meaning for the item', async () => {
    const { db, run } = await postWaste(5, 'PCS');
    await expect(run()).rejects.toThrow(/لا يمكن تحويلها إلى كيلوغرام/);
    expect(stockOf(db, MILK)).toBe(OPENING_MILK);
    expect(db.state.stockMovements).toHaveLength(0);
  });

  it('converts a grams row before judging it', async () => {
    const { run } = await postWaste(5000, 'G'); // 5 kg
    await expect(run()).resolves.toMatchObject({ success: true });
  });

  it('the gate is not waivable with allowShortage', async () => {
    const db = makeDb({ mode: 'WARNING_MODE' });
    const svc = svcFor(db);
    await svc.saveAll('t1', 'dp-1', {
      ...SHEET,
      wastages: [{ itemId: MILK, itemName: 'حليب خام', quantity: 1526, unit: 'KG' }],
    } as any);
    await expect(svc.post('t1', 'u1', 'dp-1', { allowShortage: true })).rejects.toThrow(/أكبر من إجمالي/);
    expect(db.state.dailyProductions[0].status).toBe('DRAFT');
  });

  it('bounds countable issued material in its own unit too', async () => {
    const db = makeDb();
    const svc = svcFor(db);
    await svc.saveAll('t1', 'dp-1', {
      ...SHEET,
      wastages: [{ itemId: CARTON, itemName: 'كرتون 750 غم', quantity: 200, unit: 'PCS' }],
    } as any);
    await expect(svc.post('t1', 'u1', 'dp-1')).rejects.toThrow(/أكبر من إجمالي/);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('regression — the exemption is surgical', () => {
  it('FINISHED_GOOD waste still deducts stock and still consumes its own FIFO', async () => {
    const db = makeDb();
    const svc = svcFor(db);
    await svc.saveAll('t1', 'dp-1', {
      ...SHEET,
      wastages: [{ itemId: FINISHED, itemName: 'حليب جاهز 750 غم', quantity: 7, unit: 'PCS' }],
    } as any);
    await svc.post('t1', 'u1', 'dp-1');

    expect(stockOf(db, FINISHED)).toBe(100 + 120 - 7);
    expect(
      db.state.stockMovements.some(
        (m) => m.itemId === FINISHED && m.type === 'WASTE' && Number(m.quantity) === 7,
      ),
    ).toBe(true);
    expect(db.fifo.consumed.some((c) => c.itemId === FINISHED && c.qty === 7 && c.method === 'FIFO_WASTE_FINISHED')).toBe(true);
  });

  it('OTHER waste — an item never issued here — still deducts and consumes FIFO', async () => {
    const db = makeDb();
    const svc = svcFor(db);
    await svc.saveAll('t1', 'dp-1', {
      ...SHEET,
      wastages: [{ itemId: STRAY, itemName: 'صنف مخزني آخر', quantity: 4, unit: 'PCS' }],
    } as any);
    await svc.post('t1', 'u1', 'dp-1');

    expect(stockOf(db, STRAY)).toBe(46);
    expect(db.state.stockMovements.some((m) => m.itemId === STRAY && m.type === 'WASTE')).toBe(true);
    expect(db.fifo.consumed.some((c) => c.itemId === STRAY && c.qty === 4 && c.method === 'FIFO_WASTE_RAW')).toBe(true);
  });

  it('three waste kinds on one sheet behave independently', async () => {
    const db = makeDb();
    const svc = svcFor(db);
    await svc.saveAll('t1', 'dp-1', {
      ...SHEET,
      wastages: [
        { itemId: MILK, itemName: 'حليب خام', quantity: 5, unit: 'KG' },       // issued → exempt
        { itemId: FINISHED, itemName: 'حليب جاهز 750 غم', quantity: 3, unit: 'PCS' }, // finished → deducts
        { itemId: STRAY, itemName: 'صنف مخزني آخر', quantity: 2, unit: 'PCS' },       // other → deducts
      ],
    } as any);
    await svc.post('t1', 'u1', 'dp-1');

    expect(stockOf(db, MILK)).toBe(39186);        // 39,247 − 61 only
    expect(stockOf(db, FINISHED)).toBe(217);      // 100 + 120 − 3
    expect(stockOf(db, STRAY)).toBe(48);          // 50 − 2
  });
});
