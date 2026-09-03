import { InventoryService } from './inventory.service';
import { ConflictException } from '@nestjs/common';

/**
 * Stage 4.1 — every quantity change must reach the FIFO cost layer.
 *
 * Two paths moved StockLevel and wrote StockMovement but never touched
 * PurchaseBatch: createMovement and closeCount. Every call widened the gap
 * between the balance screen and what production/sales can actually
 * consume — the root cause behind "there is stock but ترحيل fails".
 *
 * closeCount is the worst of the two: the physical count is where the
 * business asserts what stock really exists, so it was the largest
 * generator of the drift the reconciliation report keeps finding.
 */

type Row = Record<string, any>;

function makeDb(seed: { items?: Row[]; levels?: Row[]; batches?: Row[]; counts?: Row[] } = {}) {
  const state = {
    items: seed.items ?? [{ id: 'i1', tenantId: 't1', name: 'مادة', avgCost: 4, costPrice: 3 }],
    levels: seed.levels ?? [],
    movements: [] as Row[],
    batches: seed.batches ?? [],
    adjustments: [] as Row[],
    counts: seed.counts ?? [],
    seq: 0,
  };

  const matches = (r: Row, where: Row) =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (v && typeof v === 'object') {
        if ('gt' in v) return Number(r[k]) > Number((v as any).gt);
        if ('gte' in v) return Number(r[k]) >= Number((v as any).gte);
        return true;
      }
      return (r[k] ?? null) === (v ?? null);
    });

  const table = (rows: Row[]) => ({
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null,
    findUnique: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where, orderBy }: any = {}) => {
      let out = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy) {
        const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]).map((o: any) => Object.keys(o)[0]);
        out = [...out].sort((a, b) => {
          for (const k of keys) {
            const av = a[k] instanceof Date ? a[k].getTime() : a[k];
            const bv = b[k] instanceof Date ? b[k].getTime() : b[k];
            if (av < bv) return -1;
            if (av > bv) return 1;
          }
          return 0;
        });
      }
      return out;
    },
    create: async ({ data }: any) => {
      const row = { id: `r${++state.seq}`, ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      const hit = rows.filter((r) => matches(r, where));
      for (const r of hit) {
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === 'object' && 'decrement' in (v as any)) {
            r[k] = Number(r[k]) - Number((v as any).decrement);
          } else if (v && typeof v === 'object' && 'increment' in (v as any)) {
            r[k] = Number(r[k]) + Number((v as any).increment);
          } else r[k] = v;
        }
      }
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
      const hit = rows.filter((r) => matches(r, where ?? {}));
      const out: Row = {};
      for (const f of Object.keys(_sum ?? { quantity: true })) {
        out[f] = hit.reduce((s, r) => s + Number(r[f] ?? 0), 0);
      }
      return { _sum: out };
    },
    deleteMany: async () => ({ count: 0 }),
  });

  const client: any = {
    item: table(state.items),
    stockLevel: table(state.levels),
    stockMovement: table(state.movements),
    purchaseBatch: table(state.batches),
    stockAdjustment: table(state.adjustments),
    inventoryCount: table(state.counts),
    inventoryCountLine: table([]),
    warehouse: table([{ id: 'wh1', tenantId: 't1', code: 'MAIN', active: true }]),
    $queryRaw: jest.fn(async () => []),
  };
  client.$transaction = async (fn: any) => fn(client);

  return { state, client, service: new InventoryService(client, { log: async () => undefined } as any) as any };
}

const batch = (id: string, remaining: number, day = '2026-01-01') => ({
  id, tenantId: 't1', itemId: 'i1',
  purchaseDate: new Date(day), createdAt: new Date(day),
  quantity: remaining, remaining, unitCost: 4, sourceType: 'PURCHASE',
});

const sumRemaining = (s: any) => s.batches.reduce((a: number, b: Row) => a + Number(b.remaining), 0);
const sumLevels = (s: any) => s.levels.reduce((a: number, l: Row) => a + Number(l.quantity), 0);

describe('createMovement keeps FIFO in step', () => {
  it('IN creates a cost layer for the quantity added', async () => {
    const { state, service } = makeDb();
    await service.createMovement('t1', 'u1', {
      type: 'IN', itemId: 'i1', toWarehouseId: 'wh1', quantity: 50,
    });
    expect(sumLevels(state)).toBe(50);
    expect(sumRemaining(state)).toBe(50);
    expect(state.batches).toHaveLength(1);
  });

  it('tags the batch and links it back to the movement', async () => {
    const { state, service } = makeDb();
    const mv = await service.createMovement('t1', 'u1', {
      type: 'IN', itemId: 'i1', toWarehouseId: 'wh1', quantity: 50,
    });
    expect(state.batches[0].sourceType).toBe('MOVEMENT');
    expect(state.batches[0].sourceRefId).toBe(mv.id);
  });

  it('OUT consumes the cost layer instead of leaving it stranded', async () => {
    const { state, service } = makeDb({
      levels: [{ id: 'sl1', tenantId: 't1', itemId: 'i1', warehouseId: 'wh1', batchId: null, quantity: 100 }],
      batches: [batch('b1', 100)],
    });
    await service.createMovement('t1', 'u1', {
      type: 'OUT', itemId: 'i1', fromWarehouseId: 'wh1', quantity: 30,
    });
    expect(sumLevels(state)).toBe(70);
    expect(sumRemaining(state)).toBe(70);
  });

  it('WASTE also consumes FIFO', async () => {
    const { state, service } = makeDb({
      levels: [{ id: 'sl1', tenantId: 't1', itemId: 'i1', warehouseId: 'wh1', batchId: null, quantity: 40 }],
      batches: [batch('b1', 40)],
    });
    await service.createMovement('t1', 'u1', {
      type: 'WASTE', itemId: 'i1', fromWarehouseId: 'wh1', quantity: 10,
    });
    expect(sumLevels(state)).toBe(30);
    expect(sumRemaining(state)).toBe(30);
  });

  it('TRANSFER moves the balance but must NOT touch the cost layer', async () => {
    // PurchaseBatch has no warehouseId — batches are (tenantId,itemId)-scoped,
    // so a transfer is net-zero for the item and any FIFO write would corrupt it.
    const { state, service } = makeDb({
      levels: [{ id: 'sl1', tenantId: 't1', itemId: 'i1', warehouseId: 'wh1', batchId: null, quantity: 100 }],
      batches: [batch('b1', 100)],
    });
    await service.createMovement('t1', 'u1', {
      type: 'TRANSFER', itemId: 'i1', fromWarehouseId: 'wh1', toWarehouseId: 'wh2', quantity: 40,
    });
    expect(sumLevels(state)).toBe(100);
    expect(sumRemaining(state)).toBe(100);
    expect(state.batches).toHaveLength(1);
  });

  it('consumes oldest batch first', async () => {
    const { state, service } = makeDb({
      levels: [{ id: 'sl1', tenantId: 't1', itemId: 'i1', warehouseId: 'wh1', batchId: null, quantity: 100 }],
      batches: [batch('newer', 50, '2026-06-01'), batch('older', 50, '2020-01-01')],
    });
    await service.createMovement('t1', 'u1', {
      type: 'OUT', itemId: 'i1', fromWarehouseId: 'wh1', quantity: 30,
    });
    const by = Object.fromEntries(state.batches.map((b: Row) => [b.id, Number(b.remaining)]));
    expect(by.older).toBe(20);
    expect(by.newer).toBe(50);
  });
});

describe('closeCount keeps FIFO in step', () => {
  const countWith = (expected: number, actual: number) => ({
    counts: [{
      id: 'c1', tenantId: 't1', number: 'JR-1', status: 'DRAFT',
      lines: [{ id: 'l1', itemId: 'i1', warehouseId: 'wh1', expectedQty: expected, actualQty: actual, notes: null }],
    }],
  });

  it('a surplus creates a cost layer so the new stock is consumable', async () => {
    const { state, service } = makeDb({
      ...countWith(100, 120),
      levels: [{ id: 'sl1', tenantId: 't1', itemId: 'i1', warehouseId: 'wh1', batchId: null, quantity: 100 }],
      batches: [batch('b1', 100)],
    });
    await service.closeCount('t1', 'u1', 'c1');

    expect(sumLevels(state)).toBe(120);
    expect(sumRemaining(state)).toBe(120);
    const surplus = state.batches.find((b: Row) => b.sourceType === 'COUNT_SURPLUS');
    expect(surplus).toBeDefined();
    expect(Number(surplus.quantity)).toBe(20);
    expect(surplus.sourceRefId).toBe('c1');
  });

  it('a shortage retires cost layers rather than stranding them', async () => {
    const { state, service } = makeDb({
      ...countWith(100, 80),
      levels: [{ id: 'sl1', tenantId: 't1', itemId: 'i1', warehouseId: 'wh1', batchId: null, quantity: 100 }],
      batches: [batch('b1', 100)],
    });
    await service.closeCount('t1', 'u1', 'c1');

    expect(sumLevels(state)).toBe(80);
    expect(sumRemaining(state)).toBe(80);
  });

  it('a count that confirms the balance writes nothing at all', async () => {
    const { state, service } = makeDb({
      ...countWith(100, 100),
      levels: [{ id: 'sl1', tenantId: 't1', itemId: 'i1', warehouseId: 'wh1', batchId: null, quantity: 100 }],
      batches: [batch('b1', 100)],
    });
    await service.closeCount('t1', 'u1', 'c1');

    expect(sumRemaining(state)).toBe(100);
    expect(state.batches).toHaveLength(1);
    expect(state.movements).toHaveLength(0);
  });

  it('still writes the ledger and the audit row', async () => {
    const { state, service } = makeDb({
      ...countWith(100, 120),
      levels: [{ id: 'sl1', tenantId: 't1', itemId: 'i1', warehouseId: 'wh1', batchId: null, quantity: 100 }],
      batches: [batch('b1', 100)],
    });
    await service.closeCount('t1', 'u1', 'c1');

    expect(state.movements).toHaveLength(1);
    expect(state.movements[0].reasonCode).toBe('COUNT_VARIANCE');
    expect(state.adjustments).toHaveLength(1);
  });
});

describe('syncFifoForAdjustment concurrency defences', () => {
  it('takes a row lock before reading candidate batches', async () => {
    const { client, service } = makeDb({
      levels: [{ id: 'sl1', tenantId: 't1', itemId: 'i1', warehouseId: 'wh1', batchId: null, quantity: 100 }],
      batches: [batch('b1', 100)],
    });
    await service.createMovement('t1', 'u1', {
      type: 'OUT', itemId: 'i1', fromWarehouseId: 'wh1', quantity: 10,
    });
    expect(client.$queryRaw).toHaveBeenCalled();
    const sql = client.$queryRaw.mock.calls[0][0].join(' ');
    expect(sql).toMatch(/FOR UPDATE/i);
    // Must match fifo.service.ts's total order exactly, id included, or the
    // two code paths can acquire the same rows in opposite orders.
    expect(sql.replace(/\s+/g, ' ')).toMatch(
      /ORDER BY "purchaseDate" ASC, "createdAt" ASC, id ASC/,
    );
  });

  it('raises instead of over-consuming when the guarded decrement matches nothing', async () => {
    const { client, service } = makeDb({
      levels: [{ id: 'sl1', tenantId: 't1', itemId: 'i1', warehouseId: 'wh1', batchId: null, quantity: 100 }],
      batches: [batch('b1', 100)],
    });
    client.purchaseBatch.updateMany = jest.fn(async () => ({ count: 0 }));

    await expect(
      service.createMovement('t1', 'u1', {
        type: 'OUT', itemId: 'i1', fromWarehouseId: 'wh1', quantity: 10,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not throw when the batch ledger under-covers a legacy item', async () => {
    // Pre-FIFO stock: balance exists, no batches. Refusing a routine
    // correction because of a legacy gap would block real work.
    const { state, service } = makeDb({
      levels: [{ id: 'sl1', tenantId: 't1', itemId: 'i1', warehouseId: 'wh1', batchId: null, quantity: 100 }],
      batches: [],
    });
    await expect(
      service.createMovement('t1', 'u1', {
        type: 'OUT', itemId: 'i1', fromWarehouseId: 'wh1', quantity: 10,
      }),
    ).resolves.toBeDefined();
    expect(sumLevels(state)).toBe(90);
  });
});
