/**
 * Regression tests for StockLevel ↔ PurchaseBatch (FIFO) synchronisation
 * on inventory adjustments.
 *
 * THE BUG THESE LOCK OUT (incident 2026-08-16)
 * --------------------------------------------
 * `adjustStock` moved StockLevel only. FIFO consumption reads
 * PurchaseBatch.remaining, so an ADD created stock that production could
 * never consume: production showed 40,000 raw milk on the balance screen
 * while `fifo.consumeForProduction` saw 0 available and rejected the
 * posting with "الكمية المتاحة أقل من المطلوبة".
 *
 * The invariant asserted throughout: after any adjustment, the change in
 * Σ PurchaseBatch.remaining equals the change in StockLevel.
 */

import { InventoryService } from './inventory.service';

// ── Minimal in-memory Prisma double ──────────────────────────────────
function makeDb() {
  const state = {
    items: [
      { id: 'item-milk', tenantId: 't1', name: 'حليب خام', sku: 'RAW', avgCost: 2, costPrice: 1.5 },
    ] as any[],
    warehouses: [{ id: 'wh-main', tenantId: 't1', code: 'MAIN', active: true }] as any[],
    stockLevels: [] as any[],
    purchaseBatches: [] as any[],
    stockMovements: [] as any[],
    stockAdjustments: [] as any[],
    seq: 0,
  };
  const id = (p: string) => `${p}-${++state.seq}`;

  const client: any = {
    item: {
      findFirst: async ({ where }: any) =>
        state.items.find((i) => i.id === where.id && (!where.tenantId || i.tenantId === where.tenantId)) ?? null,
      findUnique: async ({ where }: any) => state.items.find((i) => i.id === where.id) ?? null,
      update: async ({ where, data }: any) => {
        const it = state.items.find((i) => i.id === where.id);
        Object.assign(it, data);
        return it;
      },
    },
    warehouse: {
      findFirst: async ({ where }: any) =>
        state.warehouses.find(
          (w) => (!where.code || w.code === where.code) && (!where.tenantId || w.tenantId === where.tenantId),
        ) ?? null,
      upsert: async ({ create }: any) => {
        const w = { id: id('wh'), ...create };
        state.warehouses.push(w);
        return w;
      },
    },
    stockLevel: {
      findFirst: async ({ where }: any) =>
        state.stockLevels.find(
          (s) =>
            s.itemId === where.itemId &&
            s.warehouseId === where.warehouseId &&
            (s.batchId ?? null) === (where.batchId ?? null),
        ) ?? null,
      create: async ({ data }: any) => {
        const row = { id: id('sl'), ...data, quantity: Number(data.quantity) };
        state.stockLevels.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = state.stockLevels.find((s) => s.id === where.id);
        row.quantity = Number(data.quantity);
        return row;
      },
      aggregate: async ({ where }: any) => {
        const sum = state.stockLevels
          .filter((s) => s.itemId === where.itemId && (s.batchId ?? null) === null)
          .reduce((a, s) => a + Number(s.quantity), 0);
        return { _sum: { quantity: sum } };
      },
    },
    purchaseBatch: {
      create: async ({ data }: any) => {
        const row = {
          id: id('pb'),
          ...data,
          quantity: Number(data.quantity),
          remaining: Number(data.remaining),
          unitCost: Number(data.unitCost),
          createdAt: new Date(2020, 0, 1 + state.seq),
        };
        state.purchaseBatches.push(row);
        return row;
      },
      findMany: async ({ where }: any) =>
        state.purchaseBatches
          .filter((b) => b.itemId === where.itemId && (where.remaining?.gt === undefined || b.remaining > where.remaining.gt))
          .sort((a, b) => +new Date(a.purchaseDate) - +new Date(b.purchaseDate)),
      update: async ({ where, data }: any) => {
        const row = state.purchaseBatches.find((b) => b.id === where.id);
        row.remaining = Number(data.remaining);
        return row;
      },
      // Stage 4.1: syncFifoForAdjustment now uses a guarded relative
      // decrement instead of writing an absolute value computed in JS.
      // The mock honours the `remaining >= take` predicate so a broken
      // guard cannot pass this suite.
      updateMany: async ({ where, data }: any) => {
        const hit = state.purchaseBatches.filter((b) => {
          if (where.id !== undefined && b.id !== where.id) return false;
          if (where.remaining?.gte !== undefined && Number(b.remaining) < Number(where.remaining.gte)) return false;
          return true;
        });
        for (const r of hit) {
          if (data.remaining?.decrement !== undefined) {
            r.remaining = Number(r.remaining) - Number(data.remaining.decrement);
          } else if (data.remaining?.increment !== undefined) {
            r.remaining = Number(r.remaining) + Number(data.remaining.increment);
          }
        }
        return { count: hit.length };
      },
    },
    stockMovement: { create: async ({ data }: any) => { state.stockMovements.push(data); return data; } },
    stockAdjustment: { create: async ({ data }: any) => { const r = { id: id('adj'), ...data }; state.stockAdjustments.push(r); return r; } },
  };

  // SELECT … FOR UPDATE row lock. A JS mock has no rows to lock, so this is
  // a no-op passthrough — the real locking behaviour is proved against
  // actual PostgreSQL in apps/api/test/fifo-concurrency.int.js.
  client.$queryRaw = async () => [];
  client.$transaction = async (fn: any) => fn(client);
  return { state, client };
}

const totalStock = (s: any) => s.stockLevels.reduce((a: number, r: any) => a + Number(r.quantity), 0);
const totalFifo = (s: any) => s.purchaseBatches.reduce((a: number, b: any) => a + Number(b.remaining), 0);

describe('adjustStock keeps StockLevel and FIFO batches synchronised', () => {
  let svc: InventoryService;
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    db = makeDb();
    svc = new InventoryService(db.client as any);
  });

  const adjust = (type: string, quantity: number, extra: any = {}) =>
    svc.adjustStock('t1', 'user-1', {
      itemId: 'item-milk',
      warehouseId: 'wh-main',
      type,
      quantity,
      reason: 'اختبار',
      ...extra,
    });

  it('ADD +1000 raw milk creates a matching PurchaseBatch so production can consume it', async () => {
    await adjust('ADD', 1000);

    expect(totalStock(db.state)).toBe(1000);
    expect(db.state.purchaseBatches).toHaveLength(1);

    const batch = db.state.purchaseBatches[0];
    expect(Number(batch.quantity)).toBe(1000);
    expect(Number(batch.remaining)).toBe(1000); // remaining matches adjusted qty
    expect(batch.sourceType).toBe('ADJUSTMENT');

    // The thing that was broken: FIFO can now cover a production run.
    expect(totalFifo(db.state)).toBeGreaterThanOrEqual(1000);
    expect(totalFifo(db.state)).toBe(totalStock(db.state));
  });

  it('uses the supplied unit cost when given, and falls back to avgCost otherwise', async () => {
    await adjust('ADD', 100, { unitCost: 7.25 });
    expect(Number(db.state.purchaseBatches[0].unitCost)).toBe(7.25);

    await adjust('ADD', 100);
    expect(Number(db.state.purchaseBatches[1].unitCost)).toBe(2); // item.avgCost
  });

  it('DEDUCT retires the oldest batches first and keeps the two ledgers equal', async () => {
    await adjust('ADD', 600);
    await adjust('ADD', 400);
    expect(totalStock(db.state)).toBe(1000);
    expect(totalFifo(db.state)).toBe(1000);

    await adjust('DEDUCT', 700);

    expect(totalStock(db.state)).toBe(300);
    expect(totalFifo(db.state)).toBe(300);
    // Oldest batch fully consumed, newest partially — FIFO order respected.
    expect(Number(db.state.purchaseBatches[0].remaining)).toBe(0);
    expect(Number(db.state.purchaseBatches[1].remaining)).toBe(300);
  });

  it('COUNT to an absolute quantity syncs both ledgers by the delta', async () => {
    await adjust('ADD', 1000);
    await adjust('COUNT', 700); // absolute set → delta -300

    expect(totalStock(db.state)).toBe(700);
    expect(totalFifo(db.state)).toBe(700);
  });

  it('repeated COUNT to the same number does not drift', async () => {
    await adjust('ADD', 1000);
    for (let i = 0; i < 5; i++) await adjust('COUNT', 700);

    expect(totalStock(db.state)).toBe(700);
    expect(totalFifo(db.state)).toBe(700);
  });

  it('a zero-delta COUNT opens no batch and moves nothing', async () => {
    await adjust('ADD', 500);
    const batchesBefore = db.state.purchaseBatches.length;

    await adjust('COUNT', 500); // delta 0

    expect(db.state.purchaseBatches).toHaveLength(batchesBefore);
    expect(totalStock(db.state)).toBe(500);
    expect(totalFifo(db.state)).toBe(500);
  });

  it('still records the StockMovement and StockAdjustment audit rows', async () => {
    await adjust('ADD', 250);
    expect(db.state.stockMovements).toHaveLength(1);
    expect(db.state.stockAdjustments).toHaveLength(1);
    expect(db.state.stockMovements[0].refType).toBe('StockAdjustment');
  });
});
