/**
 * Regression tests for the seven concrete scenarios in the
 * "Fix Inventory + Production Stock Logic" task.
 *
 * These lock in the invariants the customer reported broken:
 *   A. KG material — production consumes KG, inventory drops KG.
 *   B. Sack material — 10 sacks (bagWeightKg=25) → 250 kg. Consuming
 *      30 kg leaves 220 kg equivalent.
 *   C. Edit quantity up — 50 → 80 sets to 80, adjustment delta +30.
 *   D. Edit quantity down — 80 → 60 sets to 60, adjustment delta −20.
 *   E. Edit name only — no stock movement, no quantity change.
 *   F. Repeated editing — 5 no-op edits leave quantity unchanged. No "+1".
 *   G. Multi-material production — every material is decremented exactly
 *      once (including aluminum, which was the customer's headline bug).
 *
 * The tests are TIGHTLY scoped: they exercise the pure calculation logic
 * of the two services (InventoryService.updateItem/adjustStock,
 * DailyProductionService.post) with a hand-rolled in-memory Prisma stub
 * so we can assert on the exact deltas without a real database.
 */

import { convertToItemUnit, toKg } from './unit-conversion';

// ── In-memory Prisma stub ────────────────────────────────────────────
//
// Records enough state to answer the queries these two services make,
// and records every write for the assertions to inspect.

type Row = Record<string, any>;

interface Store {
  warehouses: Row[];
  items: Row[];
  stockLevels: Row[];
  stockMovements: Row[];
  stockAdjustments: Row[];
  dailyProductions: Row[];
  purchaseBatches: Row[];
  productionCostAllocations: Row[];
}

function makeStore(seed: Partial<Store> = {}): Store {
  return {
    warehouses: seed.warehouses ?? [],
    items: seed.items ?? [],
    stockLevels: seed.stockLevels ?? [],
    stockMovements: seed.stockMovements ?? [],
    stockAdjustments: seed.stockAdjustments ?? [],
    dailyProductions: seed.dailyProductions ?? [],
    purchaseBatches: seed.purchaseBatches ?? [],
    productionCostAllocations: seed.productionCostAllocations ?? [],
  };
}

/**
 * Minimal FIFO stub — records the real behaviour we care about
 * (decrement PurchaseBatch.remaining oldest-first, create a
 * ProductionCostAllocation per batch touched, sum totalCost).
 * Keeps tests independent of the real FifoCostingService while
 * still exercising the invariants B1 requires.
 */
function makeFifoStub(store: Store) {
  return {
    consumeForProduction: jest.fn(async (_tenantId: string, dto: any) => {
      const need = Number(dto.quantity);
      if (need <= 0) return { totalCost: 0, allocations: [], quantityConsumed: 0 };
      const batches = store.purchaseBatches
        .filter((b) => b.itemId === dto.rawItemId && Number(b.remaining) > 0)
        .sort((a, b) =>
          new Date(a.purchaseDate).getTime() - new Date(b.purchaseDate).getTime(),
        );
      const totalAvail = batches.reduce((s, b) => s + Number(b.remaining), 0);
      if (totalAvail + 1e-9 < need) {
        throw new Error('دفعات المادة الخام غير كافية');
      }
      let rem = need, totalCost = 0;
      const allocations: any[] = [];
      for (const b of batches) {
        if (rem <= 0) break;
        const take = Math.min(Number(b.remaining), rem);
        const cost = take * Number(b.unitCost);
        b.remaining = Number(b.remaining) - take;
        totalCost += cost;
        rem -= take;
        const alloc = {
          id: `pca-${store.productionCostAllocations.length + 1}`,
          tenantId: dto.tenantId ?? 't1',
          dailyProductionId: dto.dailyProductionId,
          rawItemId: dto.rawItemId,
          batchId: b.id,
          quantity: take,
          unitCost: Number(b.unitCost),
          totalCost: cost,
        };
        store.productionCostAllocations.push(alloc);
        allocations.push(alloc);
      }
      return { totalCost, allocations, quantityConsumed: need - rem };
    }),
    reverseForProduction: jest.fn(async (_tenantId: string, dpId: string) => {
      const affected = store.productionCostAllocations.filter(
        (a) => a.dailyProductionId === dpId,
      );
      for (const a of affected) {
        const b = store.purchaseBatches.find((x) => x.id === a.batchId);
        if (b) b.remaining = Number(b.remaining) + Number(a.quantity);
      }
      store.productionCostAllocations = store.productionCostAllocations.filter(
        (a) => a.dailyProductionId !== dpId,
      );
      return { restoredAllocations: affected.length };
    }),
  };
}

/**
 * Minimal Prisma-shaped client covering only the calls the services use.
 * We hand-roll it so an assertion failure points at business logic, not
 * a mocking library quirk.
 */
function makePrismaMock(store: Store) {
  let nextId = 1;
  const uuid = () => `test-${nextId++}`;

  const findFirst = (rows: Row[]) => (args: any) => {
    const w = args?.where ?? {};
    return rows.find((r) =>
      Object.entries(w).every(([k, v]) => {
        if (v && typeof v === 'object' && !(v as any).equals) {
          // Prisma "not: null" / "gte: date" etc. — not needed here.
          return true;
        }
        return r[k] === v;
      }),
    );
  };
  const findMany = (rows: Row[]) => async (args: any) =>
    rows.filter((r) => {
      const w = args?.where ?? {};
      return Object.entries(w).every(([k, v]) => r[k] === v);
    });
  const aggregate = (rows: Row[]) => async (args: any) => {
    const w = args?.where ?? {};
    const filtered = rows.filter((r) =>
      Object.entries(w).every(([k, v]) => r[k] === v || v === undefined),
    );
    return {
      _sum: {
        quantity: filtered.reduce((s, r) => s + Number(r.quantity ?? 0), 0),
      },
    };
  };

  const tableApi = (rows: Row[]) => ({
    findFirst: async (args: any) => findFirst(rows)(args),
    findMany: findMany(rows),
    findUnique: async (args: any) => rows.find((r) => r.id === args.where.id),
    create: async (args: any) => {
      const row = { id: uuid(), ...args.data };
      rows.push(row);
      return row;
    },
    update: async (args: any) => {
      const row = rows.find((r) => r.id === args.where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, args.data);
      return row;
    },
    /**
     * updateMany — conditional atomic update. This is the primitive
     * G4 (double-post protection) relies on: only the FIRST call whose
     * WHERE clause still matches gets count===1. A second concurrent
     * call sees the row already flipped and gets count===0.
     * We simulate the atomicity by iterating once, matching + mutating
     * inline before returning.
     */
    updateMany: async (args: any) => {
      const matcher = args?.where ?? {};
      let count = 0;
      for (const r of rows) {
        const ok = Object.entries(matcher).every(([k, v]) => {
          if (v === null || typeof v !== 'object') return r[k] === v;
          // Prisma "not: X" filter — minimal support.
          if ('not' in (v as any)) return r[k] !== (v as any).not;
          return r[k] === v;
        });
        if (ok) {
          Object.assign(r, args.data);
          count++;
        }
      }
      return { count };
    },
    delete: async (args: any) => {
      const i = rows.findIndex((r) => r.id === args.where.id);
      if (i >= 0) rows.splice(i, 1);
      return {};
    },
    deleteMany: async (args: any) => {
      const matcher = args?.where ?? {};
      let removed = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        const ok = Object.entries(matcher).every(([k, v]) => rows[i][k] === v);
        if (ok) { rows.splice(i, 1); removed++; }
      }
      return { count: removed };
    },
    aggregate: aggregate(rows),
  });

  const client: any = {
    warehouse: tableApi(store.warehouses),
    item: tableApi(store.items),
    stockLevel: tableApi(store.stockLevels),
    stockMovement: tableApi(store.stockMovements),
    stockAdjustment: tableApi(store.stockAdjustments),
    dailyProduction: tableApi(store.dailyProductions),
    purchaseBatch: tableApi(store.purchaseBatches),
    productionCostAllocation: tableApi(store.productionCostAllocations),
    productionCartonUsage: tableApi([]),
    productionAluminumUsage: tableApi([]),
    productionMilkUsage: tableApi([]),
    productionProducedItem: tableApi([]),
    productionWaste: tableApi([]),
    $transaction: async (fn: any) => {
      if (typeof fn === 'function') return fn(client);
      // array form not used here
      return Promise.all(fn);
    },
  };
  return client;
}

// ── Fixtures ────────────────────────────────────────────────────────
const TENANT = 't1';
const USER = 'u1';
function seedMainWarehouse(store: Store) {
  const wh = { id: 'wh-main', tenantId: TENANT, code: 'MAIN', name: 'Main', active: true };
  store.warehouses.push(wh);
  return wh;
}
function seedItem(store: Store, over: Partial<Row> = {}) {
  const item = {
    id: over.id ?? 'item-1',
    tenantId: TENANT,
    name: over.name ?? 'Test Item',
    unit: over.unit ?? 'KG',
    bagWeightKg: over.bagWeightKg ?? null,
    packsPerCarton: over.packsPerCarton ?? null,
    active: true,
    ...over,
  };
  store.items.push(item);
  return item;
}
function seedStockLevel(
  store: Store,
  itemId: string,
  warehouseId: string,
  qty: number,
) {
  const sl = {
    id: `sl-${store.stockLevels.length + 1}`,
    tenantId: TENANT,
    itemId,
    warehouseId,
    batchId: null,
    quantity: qty,
  };
  store.stockLevels.push(sl);
  return sl;
}
/**
 * seedBatch — creates a PurchaseBatch mirroring a StockLevel so that
 * daily-production.post()'s new call to fifo.consumeForProduction can
 * find raw material to consume. Every raw item used in a production
 * test MUST have a paired batch, otherwise the FIFO service throws
 * "دفعات المادة الخام غير كافية" and the transaction rolls back
 * (which is the correct production behaviour — you can't produce
 * from thin air).
 */
function seedBatch(
  store: Store,
  itemId: string,
  qty: number,
  unitCost: number,
  purchaseDate: Date = new Date('2026-01-01'),
) {
  const b = {
    id: `pb-${store.purchaseBatches.length + 1}`,
    tenantId: TENANT,
    itemId,
    batchNumber: null,
    purchaseDate,
    quantity: qty,
    remaining: qty,
    unitCost,
    currency: 'JOD',
    sourceType: 'SUPPLIER',
    sourceRefId: null,
  };
  store.purchaseBatches.push(b);
  return b;
}

// ── UNIT CONVERSION ─────────────────────────────────────────────────
describe('unit-conversion helper', () => {
  it('KG → KG is identity', () => {
    expect(convertToItemUnit({ unit: 'KG' }, 100, 'KG')).toBe(100);
  });
  it('G → KG divides by 1000', () => {
    expect(convertToItemUnit({ unit: 'KG' }, 500, 'G')).toBe(0.5);
  });
  it('BAG → KG uses per-item bagWeightKg (not a global 25)', () => {
    expect(convertToItemUnit({ unit: 'KG', bagWeightKg: 25 }, 10, 'BAG')).toBe(250);
    expect(convertToItemUnit({ unit: 'KG', bagWeightKg: 50 }, 10, 'BAG')).toBe(500);
  });
  it('BAG → KG throws when bagWeightKg is missing', () => {
    expect(() => convertToItemUnit({ unit: 'KG' }, 10, 'BAG')).toThrow(/وزن الشوال/);
  });
  it('CTN → PCS uses packsPerCarton', () => {
    expect(convertToItemUnit({ unit: 'PCS', packsPerCarton: 12 }, 3, 'CTN')).toBe(36);
  });
  it('toKg returns null for non-weight units', () => {
    expect(toKg({ unit: 'PCS' }, 10)).toBeNull();
    expect(toKg({ unit: 'CTN' }, 10)).toBeNull();
  });
});

// ── Inventory service (edit + adjust) ──────────────────────────────
describe('InventoryService — item edit + set-quantity', () => {
  // Late import so the ts-jest transform sees our jest fixture setup.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { InventoryService } = require('./inventory.service');

  it('Scenario E — editing NAME only does not touch stock or create movements', async () => {
    const store = makeStore();
    seedMainWarehouse(store);
    const item = seedItem(store, { name: 'Aluminum', unit: 'KG' });
    seedStockLevel(store, item.id, 'wh-main', 60);

    const svc = new InventoryService(makePrismaMock(store));
    await svc.updateItem(TENANT, item.id, { name: 'Aluminum Foil' });

    expect(item.name).toBe('Aluminum Foil');
    expect(Number(store.stockLevels[0].quantity)).toBe(60);
    expect(store.stockMovements).toHaveLength(0);
    expect(store.stockAdjustments).toHaveLength(0);
  });

  it('Scenario F — repeated edits (5x) never change stock ("+1 bug" regression)', async () => {
    const store = makeStore();
    seedMainWarehouse(store);
    const item = seedItem(store, { name: 'X', unit: 'KG' });
    seedStockLevel(store, item.id, 'wh-main', 10);

    const svc = new InventoryService(makePrismaMock(store));
    for (let i = 0; i < 5; i++) {
      await svc.updateItem(TENANT, item.id, { name: 'X', barcode: 'BAR' });
    }
    expect(Number(store.stockLevels[0].quantity)).toBe(10);
    expect(store.stockMovements).toHaveLength(0);
    expect(store.stockAdjustments).toHaveLength(0);
  });

  it('Scenario C — COUNT adjustment from 50 → 80 SETS quantity, delta = +30', async () => {
    const store = makeStore();
    seedMainWarehouse(store);
    const item = seedItem(store, { unit: 'KG' });
    seedStockLevel(store, item.id, 'wh-main', 50);

    const svc = new InventoryService(makePrismaMock(store));
    const res = await svc.adjustStock(TENANT, USER, {
      itemId: item.id, type: 'COUNT', quantity: 80, reason: 'جرد',
    });
    expect(res.before).toBe(50);
    expect(res.after).toBe(80);
    expect(res.delta).toBe(30);
    expect(Number(store.stockLevels[0].quantity)).toBe(80);
    expect(store.stockAdjustments).toHaveLength(1);
    expect(Number(store.stockAdjustments[0].quantityAfter)).toBe(80);
  });

  it('Scenario D — COUNT adjustment from 80 → 60 SETS quantity, delta = -20', async () => {
    const store = makeStore();
    seedMainWarehouse(store);
    const item = seedItem(store, { unit: 'KG' });
    seedStockLevel(store, item.id, 'wh-main', 80);

    const svc = new InventoryService(makePrismaMock(store));
    const res = await svc.adjustStock(TENANT, USER, {
      itemId: item.id, type: 'COUNT', quantity: 60, reason: 'جرد',
    });
    expect(res.delta).toBe(-20);
    expect(res.after).toBe(60);
    expect(Number(store.stockLevels[0].quantity)).toBe(60);
  });

  it('COUNT with residual stock in a legacy warehouse still sets ITEM total (single-warehouse invariant)', async () => {
    const store = makeStore();
    seedMainWarehouse(store);
    const legacy = { id: 'wh-legacy', tenantId: TENANT, code: 'PKG', name: 'Legacy', active: false };
    store.warehouses.push(legacy);
    const item = seedItem(store, { unit: 'KG' });
    seedStockLevel(store, item.id, 'wh-main', 50);
    seedStockLevel(store, item.id, 'wh-legacy', 20); // residual — real customer data

    const svc = new InventoryService(makePrismaMock(store));
    const res = await svc.adjustStock(TENANT, USER, {
      itemId: item.id, type: 'COUNT', quantity: 60, reason: 'جرد',
    });
    // Total was 50 + 20 = 70. Setting COUNT to 60 must push MAIN by -10
    // so item total becomes exactly 60, not 60 + 20 = 80.
    expect(res.delta).toBe(-10);
    expect(Number(store.stockLevels[0].quantity)).toBe(40); // MAIN
    expect(Number(store.stockLevels[1].quantity)).toBe(20); // legacy untouched (data preservation)
    // But summed across warehouses:
    const total = store.stockLevels.reduce((s, r) => s + Number(r.quantity), 0);
    expect(total).toBe(60);
  });
});

// ── Production service (multi-material deduct, aluminum incl.) ──────
describe('DailyProductionService.post — multi-material deduction', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DailyProductionService } = require('../daily-production/daily-production.service');

  function seedDailyProduction(store: Store, rows: {
    carton?: Row[]; aluminum?: Row[]; milk?: Row[]; produced?: Row[]; wastages?: Row[];
  }) {
    const dp = {
      id: 'dp-1',
      tenantId: TENANT,
      status: 'DRAFT',
      cartonUsage: rows.carton ?? [],
      aluminumUsage: rows.aluminum ?? [],
      milkUsage: rows.milk ?? [],
      produced: rows.produced ?? [],
      wastages: rows.wastages ?? [],
    };
    store.dailyProductions.push(dp);
    return dp;
  }

  it('Scenario A — KG material: 100 → −7.5 leaves 92.5', async () => {
    const store = makeStore();
    seedMainWarehouse(store);
    const alu = seedItem(store, { id: 'alu', name: 'Aluminum', unit: 'KG' });
    seedStockLevel(store, alu.id, 'wh-main', 100);
    seedBatch(store, alu.id, 100, 2.0); // matched batch for FIFO consume
    seedDailyProduction(store, {
      aluminum: [{ id: 'a1', itemId: alu.id, itemName: 'Aluminum', quantity: 7.5, warehouseId: null }],
    });

    const svc = new DailyProductionService(makePrismaMock(store), makeFifoStub(store) as any);
    await svc.post(TENANT, USER, 'dp-1');

    expect(Number(store.stockLevels[0].quantity)).toBe(92.5);
    expect(store.stockMovements).toHaveLength(1);
    expect(store.stockMovements[0].reasonCode).toBe('PROD_ALUMINUM');
    expect(store.stockMovements[0].type).toBe('OUT');
  });

  it('Scenario G — every selected material is decremented exactly once (aluminum included)', async () => {
    const store = makeStore();
    seedMainWarehouse(store);
    const milk = seedItem(store, { id: 'milk', name: 'Milk', unit: 'KG' });
    const powder = seedItem(store, { id: 'pw', name: 'Powder', unit: 'KG' });
    const alu = seedItem(store, { id: 'alu', name: 'Aluminum', unit: 'KG' });
    const carton = seedItem(store, { id: 'ctn', name: 'Cartons', unit: 'PCS' });

    seedStockLevel(store, milk.id, 'wh-main', 1000);
    seedStockLevel(store, powder.id, 'wh-main', 500);
    seedStockLevel(store, alu.id, 'wh-main', 50);
    seedStockLevel(store, carton.id, 'wh-main', 200);
    // Matching PurchaseBatches so FIFO can consume raw materials.
    seedBatch(store, milk.id, 1000, 1.0);
    seedBatch(store, powder.id, 500, 2.0);
    seedBatch(store, alu.id, 50, 3.0);
    seedBatch(store, carton.id, 200, 0.5);

    seedDailyProduction(store, {
      milk: [
        { id: 'm1', itemId: milk.id,   itemName: 'Milk',   quantity: 100, count: 4, unit: 'KG', warehouseId: null },
        { id: 'm2', itemId: powder.id, itemName: 'Powder', quantity: 25,  count: 1, unit: 'KG', warehouseId: null },
      ],
      aluminum: [{ id: 'a1', itemId: alu.id,    itemName: 'Aluminum', quantity: 3,  warehouseId: null }],
      carton:   [{ id: 'c1', itemId: carton.id, itemName: 'Cartons',  quantity: 20, warehouseId: null }],
    });

    const svc = new DailyProductionService(makePrismaMock(store), makeFifoStub(store) as any);
    await svc.post(TENANT, USER, 'dp-1');

    const balance = (id: string) => Number(store.stockLevels.find((s) => s.itemId === id)!.quantity);
    expect(balance('milk')).toBe(900);
    expect(balance('pw')).toBe(475);
    expect(balance('alu')).toBe(47);
    expect(balance('ctn')).toBe(180);
    // One movement per row, no duplicates.
    expect(store.stockMovements).toHaveLength(4);
    const codes = store.stockMovements.map((m) => m.reasonCode).sort();
    expect(codes).toEqual(['PROD_ALUMINUM', 'PROD_CARTON', 'PROD_MILK', 'PROD_MILK']);
  });

  it('rejects a row with quantity > 0 but no itemId (silent-drop regression)', async () => {
    const store = makeStore();
    seedMainWarehouse(store);
    seedDailyProduction(store, {
      aluminum: [{ id: 'a1', itemId: null, itemName: 'رول ألمنيوم', quantity: 3, warehouseId: null }],
    });
    const svc = new DailyProductionService(makePrismaMock(store), makeFifoStub(store) as any);
    await expect(svc.post(TENANT, USER, 'dp-1')).rejects.toThrow(/يجب اختيار الصنف/);
  });

  it('rejects over-consumption instead of silently clamping to zero', async () => {
    const store = makeStore();
    seedMainWarehouse(store);
    const alu = seedItem(store, { id: 'alu', name: 'Aluminum', unit: 'KG' });
    seedStockLevel(store, alu.id, 'wh-main', 5);
    seedDailyProduction(store, {
      aluminum: [{ id: 'a1', itemId: alu.id, itemName: 'Aluminum', quantity: 20, warehouseId: null }],
    });
    const svc = new DailyProductionService(makePrismaMock(store), makeFifoStub(store) as any);
    await expect(svc.post(TENANT, USER, 'dp-1')).rejects.toThrow(/المخزون لا يكفي/);
  });
});

// ── Production cancel — reversal MUST land on MAIN, not on the historical warehouseId
describe('DailyProductionService.cancel — reversal lands on MAIN', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DailyProductionService } = require('../daily-production/daily-production.service');

  it('post→cancel routes the reversal delta to MAIN even when historical StockMovement points to a legacy warehouse', async () => {
    const store = makeStore();
    const main = seedMainWarehouse(store);
    // Simulate a POST that was made pre-single-warehouse migration —
    // movements reference a legacy warehouse (`legacyWh`) that now
    // holds quantity=0 after consolidation.
    const legacyWh = { id: 'wh-legacy', tenantId: TENANT, code: 'PKG', name: 'Legacy PKG', active: false };
    store.warehouses.push(legacyWh);
    const alu = seedItem(store, { id: 'alu', name: 'Aluminum', unit: 'KG' });
    // Post-consolidation state: MAIN=50, legacy=0.
    seedStockLevel(store, alu.id, main.id, 50);
    seedStockLevel(store, alu.id, legacyWh.id, 0);
    // Historical POSTED production with an OUT movement pointing at legacy.
    const dp = {
      id: 'dp-legacy', tenantId: TENANT, status: 'POSTED',
      cartonUsage: [], aluminumUsage: [], milkUsage: [], produced: [], wastages: [],
    };
    store.dailyProductions.push(dp);
    store.stockMovements.push({
      id: 'sm-1', tenantId: TENANT, refType: 'DailyProduction', refId: dp.id,
      type: 'OUT', itemId: alu.id, fromWarehouseId: legacyWh.id, toWarehouseId: null,
      quantity: 5, reasonCode: 'PROD_ALUMINUM',
    });

    const svc = new DailyProductionService(makePrismaMock(store), makeFifoStub(store) as any);
    await svc.cancel(TENANT, USER, 'dp-legacy');

    // MAIN must have received the +5 reversal.
    const mainLevel = store.stockLevels.find((s) => s.warehouseId === main.id && s.itemId === alu.id)!;
    expect(Number(mainLevel.quantity)).toBe(55);
    // Legacy warehouse must NOT have moved from 0 (would be phantom stock).
    const legacyLevel = store.stockLevels.find((s) => s.warehouseId === legacyWh.id && s.itemId === alu.id)!;
    expect(Number(legacyLevel.quantity)).toBe(0);
    // The reversal StockMovement still names the legacy warehouse for audit continuity.
    const reversal = store.stockMovements.find((m) => m.reasonCode === 'REVERSAL')!;
    expect(reversal).toBeDefined();
    expect(reversal.toWarehouseId).toBe(legacyWh.id);
  });
});

// ── Production post — creates a PurchaseBatch for produced cartons (FIFO fix)
describe('DailyProductionService.post — creates PurchaseBatch for produced cartons', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DailyProductionService } = require('../daily-production/daily-production.service');

  it('post writes one PurchaseBatch per produced row with unitCost derived from raw usage', async () => {
    const store = makeStore();
    const main = seedMainWarehouse(store);
    const milk   = seedItem(store, { id: 'milk',   unit: 'KG', avgCost: 1.5 });
    const powder = seedItem(store, { id: 'powder', unit: 'KG', avgCost: 2.0 });
    const finished = seedItem(store, { id: 'fin', unit: 'PCS', avgCost: 0 });
    seedStockLevel(store, milk.id, main.id, 1000);
    seedStockLevel(store, powder.id, main.id, 500);
    seedStockLevel(store, finished.id, main.id, 0);
    // FIFO batches at the same cost as the item avgCost so the raw
    // cost derivation matches: 100 × 1.5 + 50 × 2.0 = 250, per carton = 2.5.
    seedBatch(store, milk.id,   1000, 1.5);
    seedBatch(store, powder.id, 500,  2.0);

    const dp = {
      id: 'dp-1', tenantId: TENANT, status: 'DRAFT',
      cartonUsage: [],
      aluminumUsage: [],
      milkUsage: [
        { id: 'm1', itemId: milk.id,   itemName: 'Milk',   quantity: 100, count: 4, unit: 'KG', warehouseId: null },
        { id: 'm2', itemId: powder.id, itemName: 'Powder', quantity: 50,  count: 1, unit: 'KG', warehouseId: null },
      ],
      produced: [
        { id: 'p1', itemId: finished.id, itemName: 'Cartons', cartonsTotal: 100, warehouseId: null },
      ],
      wastages: [],
    };
    store.dailyProductions.push(dp);

    const svc = new DailyProductionService(makePrismaMock(store), makeFifoStub(store) as any);
    await svc.post(TENANT, USER, 'dp-1');

    // Raw cost = 100*1.5 + 50*2.0 = 150 + 100 = 250.
    // Per carton = 250 / 100 = 2.5.
    const producedBatch = store.purchaseBatches.find(
      (b) => b.sourceType === 'PRODUCTION' && b.sourceRefId === 'dp-1',
    );
    expect(producedBatch).toBeDefined();
    expect(producedBatch!.itemId).toBe(finished.id);
    expect(Number(producedBatch!.quantity)).toBe(100);
    expect(Number(producedBatch!.remaining)).toBe(100);
    expect(Number(producedBatch!.unitCost)).toBeCloseTo(2.5, 6);
  });

  it('falls back to finished item avgCost when no raw usage is recorded', async () => {
    const store = makeStore();
    const main = seedMainWarehouse(store);
    const finished = seedItem(store, { id: 'fin', unit: 'PCS', avgCost: 3.75 });
    seedStockLevel(store, finished.id, main.id, 0);
    const dp = {
      id: 'dp-2', tenantId: TENANT, status: 'DRAFT',
      cartonUsage: [], aluminumUsage: [], milkUsage: [],
      produced: [{ id: 'p1', itemId: finished.id, itemName: 'X', cartonsTotal: 10, warehouseId: null }],
      wastages: [],
    };
    store.dailyProductions.push(dp);
    const svc = new DailyProductionService(makePrismaMock(store), makeFifoStub(store) as any);
    await svc.post(TENANT, USER, 'dp-2');
    expect(store.purchaseBatches).toHaveLength(1);
    expect(Number(store.purchaseBatches[0].unitCost)).toBe(3.75);
  });
});

// ── G4: Double-post protection — exactly one of two concurrent posts
//        may materialise inventory effects ──────────────────────────
describe('DailyProductionService.post — double-post protection (G4)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DailyProductionService } = require('../daily-production/daily-production.service');

  it('two concurrent posts: exactly one succeeds, exactly one throws, exactly one set of movements', async () => {
    const store = makeStore();
    const main = seedMainWarehouse(store);
    const milk = seedItem(store, { id: 'milk', unit: 'KG' });
    const fin = seedItem(store, { id: 'fin', unit: 'PCS' });
    seedStockLevel(store, milk.id, main.id, 100);
    seedStockLevel(store, fin.id, main.id, 0);
    seedBatch(store, milk.id, 100, 2.0);
    const dp = {
      id: 'dp-race', tenantId: TENANT, status: 'DRAFT',
      cartonUsage: [], aluminumUsage: [],
      milkUsage: [{ id: 'm1', itemId: milk.id, itemName: 'M', quantity: 40, count: 2, unit: 'KG', warehouseId: null }],
      produced: [{ id: 'p1', itemId: fin.id, itemName: 'X', cartonsTotal: 5, warehouseId: null }],
      wastages: [],
    };
    store.dailyProductions.push(dp);

    // updateMany semantics: only the FIRST call that matches
    // status:'DRAFT' should succeed with count===1; every subsequent
    // call sees status:'POSTING' or 'POSTED' and gets count===0.
    // We fire two concurrent posts on the same DP.
    const fifo = makeFifoStub(store);
    const prisma = makePrismaMock(store);
    const svc = new DailyProductionService(prisma, fifo as any);

    const results = await Promise.allSettled([
      svc.post(TENANT, USER, 'dp-race'),
      svc.post(TENANT, USER, 'dp-race'),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected  = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // Exactly one set of movements — two milk OUT movements would mean
    // the race was won by both.
    const milkMovements = store.stockMovements.filter(
      (m) => m.itemId === milk.id && m.reasonCode === 'PROD_MILK',
    );
    expect(milkMovements).toHaveLength(1);
    const producedIn = store.stockMovements.filter(
      (m) => m.reasonCode === 'PROD_OUTPUT',
    );
    expect(producedIn).toHaveLength(1);
    // Exactly one produced PurchaseBatch (not two).
    const producedBatches = store.purchaseBatches.filter(
      (b) => b.sourceType === 'PRODUCTION' && b.sourceRefId === 'dp-race',
    );
    expect(producedBatches).toHaveLength(1);
  });
});

// ── B1: Raw-material FIFO — batches must be consumed oldest-first
//        AND cancel must restore them, exactly ─────────────────────
describe('DailyProductionService — raw-material FIFO invariants (B1)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DailyProductionService } = require('../daily-production/daily-production.service');

  it('consumeForProduction takes oldest batch first (FIFO)', async () => {
    const store = makeStore();
    seedMainWarehouse(store);
    const milk = seedItem(store, { id: 'milk', name: 'Milk', unit: 'KG', avgCost: 1.5 });
    const finished = seedItem(store, { id: 'fin', unit: 'PCS', avgCost: 0 });
    seedStockLevel(store, milk.id, 'wh-main', 150);
    seedStockLevel(store, finished.id, 'wh-main', 0);
    // Two supplier batches at different costs — FIFO must pick the
    // older one first.
    seedBatch(store, milk.id, 100, 1.0, new Date('2026-01-01'));
    seedBatch(store, milk.id, 50,  3.0, new Date('2026-02-01'));

    const dp = {
      id: 'dp-fifo', tenantId: TENANT, status: 'DRAFT',
      cartonUsage: [], aluminumUsage: [],
      milkUsage: [{ id: 'm1', itemId: milk.id, itemName: 'Milk', quantity: 120, count: 5, unit: 'KG', warehouseId: null }],
      produced: [{ id: 'p1', itemId: finished.id, itemName: 'X', cartonsTotal: 10, warehouseId: null }],
      wastages: [],
    };
    store.dailyProductions.push(dp);

    const fifo = makeFifoStub(store);
    const svc = new DailyProductionService(makePrismaMock(store), fifo as any);
    await svc.post(TENANT, USER, 'dp-fifo');

    // Older batch fully consumed (100 → 0), newer batch partially (50 → 30).
    expect(Number(store.purchaseBatches[0].remaining)).toBe(0);
    expect(Number(store.purchaseBatches[1].remaining)).toBe(30);
    // ProductionCostAllocation recorded per batch consumed.
    const allocs = store.productionCostAllocations.filter(
      (a) => a.dailyProductionId === 'dp-fifo',
    );
    expect(allocs).toHaveLength(2);
    expect(allocs[0].batchId).toBe(store.purchaseBatches[0].id);
    expect(Number(allocs[0].quantity)).toBe(100);
    expect(Number(allocs[1].quantity)).toBe(20);
    // Cost = 100×1.0 + 20×3.0 = 160. Per carton = 160/10 = 16.
    const producedBatch = store.purchaseBatches.find(
      (b) => b.sourceType === 'PRODUCTION' && b.sourceRefId === 'dp-fifo',
    );
    expect(producedBatch).toBeDefined();
    expect(Number(producedBatch!.unitCost)).toBeCloseTo(16, 6);
  });

  it('cancel restores every batch consumed + wipes ProductionCostAllocation', async () => {
    const store = makeStore();
    seedMainWarehouse(store);
    const milk = seedItem(store, { id: 'milk', unit: 'KG' });
    const finished = seedItem(store, { id: 'fin', unit: 'PCS' });
    seedStockLevel(store, milk.id, 'wh-main', 100);
    seedStockLevel(store, finished.id, 'wh-main', 0);
    seedBatch(store, milk.id, 100, 2.0);

    const dp = {
      id: 'dp-cancel', tenantId: TENANT, status: 'DRAFT',
      cartonUsage: [], aluminumUsage: [],
      milkUsage: [{ id: 'm1', itemId: milk.id, itemName: 'Milk', quantity: 40, count: 2, unit: 'KG', warehouseId: null }],
      produced: [{ id: 'p1', itemId: finished.id, itemName: 'X', cartonsTotal: 8, warehouseId: null }],
      wastages: [],
    };
    store.dailyProductions.push(dp);

    const fifo = makeFifoStub(store);
    const svc = new DailyProductionService(makePrismaMock(store), fifo as any);
    await svc.post(TENANT, USER, 'dp-cancel');
    // After post: milk batch 100 → 60, one PCA, one produced batch (8 × 2.0/8=1.0).
    expect(Number(store.purchaseBatches[0].remaining)).toBe(60);
    expect(store.productionCostAllocations).toHaveLength(1);

    await svc.cancel(TENANT, USER, 'dp-cancel');
    // Milk batch restored to 100, PCA wiped, produced batch removed.
    expect(Number(store.purchaseBatches[0].remaining)).toBe(100);
    expect(store.productionCostAllocations).toHaveLength(0);
    const producedBatchLeft = store.purchaseBatches.find(
      (b) => b.sourceType === 'PRODUCTION' && b.sourceRefId === 'dp-cancel',
    );
    expect(producedBatchLeft).toBeUndefined();
  });

  it('post refuses when raw-material batches are insufficient (rollback)', async () => {
    const store = makeStore();
    seedMainWarehouse(store);
    const milk = seedItem(store, { id: 'milk', unit: 'KG' });
    const finished = seedItem(store, { id: 'fin', unit: 'PCS' });
    seedStockLevel(store, milk.id, 'wh-main', 100);
    seedStockLevel(store, finished.id, 'wh-main', 0);
    seedBatch(store, milk.id, 5, 2.0); // batches insufficient for consumption of 40

    const dp = {
      id: 'dp-short', tenantId: TENANT, status: 'DRAFT',
      cartonUsage: [], aluminumUsage: [],
      milkUsage: [{ id: 'm1', itemId: milk.id, itemName: 'Milk', quantity: 40, count: 2, unit: 'KG', warehouseId: null }],
      produced: [{ id: 'p1', itemId: finished.id, itemName: 'X', cartonsTotal: 8, warehouseId: null }],
      wastages: [],
    };
    store.dailyProductions.push(dp);

    const fifo = makeFifoStub(store);
    const svc = new DailyProductionService(makePrismaMock(store), fifo as any);
    await expect(svc.post(TENANT, USER, 'dp-short')).rejects.toThrow();
    // No side effects — allocation array is empty (transaction rollback semantics
    // in real Prisma; our stub doesn't roll back but the throw prevents the
    // produced-batch step from running, which is what we assert).
    const producedBatchNotCreated = store.purchaseBatches.find(
      (b) => b.sourceType === 'PRODUCTION' && b.sourceRefId === 'dp-short',
    );
    expect(producedBatchNotCreated).toBeUndefined();
  });
});

// ── Scenario B (SACK → KG conversion), asserted at helper level ─────
describe('Scenario B — sack material converted via bagWeightKg', () => {
  it('10 sacks × 25 kg = 250 kg; consuming 30 kg leaves 220 kg equivalent', () => {
    const item = { unit: 'BAG', bagWeightKg: 25 };
    // The item is stocked in BAG. The production sheet captured milk
    // consumption in KG. Convert to the item unit to figure out the
    // decrement in sacks.
    const decrementInSacks = convertToItemUnit(item, 30, 'KG');
    expect(decrementInSacks).toBe(30 / 25); // 1.2 sacks
    const startSacks = 10;
    const remainingSacks = startSacks - decrementInSacks;
    // Total starting weight in KG:
    expect(toKg(item, startSacks)).toBe(250);
    // Remaining weight in KG (use toBeCloseTo — the sacks arithmetic
    // introduces a 1e-14 floating-point residue on 8.8 × 25).
    expect(toKg(item, remainingSacks)!).toBeCloseTo(220, 6);
  });
});
