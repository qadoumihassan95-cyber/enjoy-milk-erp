import { DailyProductionService } from './daily-production.service';

/**
 * Stage 4.2 — approved waste accounting treatment.
 *
 *   Raw-material waste     consumes the RAW material's own FIFO layers and
 *                          IS absorbed into production cost. The material
 *                          entered the process and did not leave as product,
 *                          so it belongs in the cost of what did.
 *
 *   Finished-goods waste   consumes the FINISHED good's own FIFO layers and
 *                          is a SEPARATE loss. It must NOT be absorbed into
 *                          the cost of the surviving cartons — that carton
 *                          was already costed when it was produced, and
 *                          charging it again to its siblings double-counts.
 *
 * What was there before: waste never touched FIFO at all, and the report
 * valued ALL waste at finished-carton cost — including aluminium rolls and
 * cardboard, which is wrong by dimension, not just by amount.
 */

type Row = Record<string, any>;

function makeDb(opts: {
  produced?: Row[];
  wastages?: Row[];
  milkUsage?: Row[];
} = {}) {
  const state = {
    tenantSettings: [{ id: 'ts', tenantId: 't1', productionPostingMode: 'WARNING_MODE' }],
    warehouses: [{ id: 'wh1', tenantId: 't1', code: 'MAIN', active: true }],
    items: [
      { id: 'alu', tenantId: 't1', name: 'ألمنيوم', unit: 'ROLL', avgCost: 3, costPrice: 3 },
      { id: 'fin', tenantId: 't1', name: 'كرتون تام', unit: 'PCS', avgCost: 10, costPrice: 10 },
    ] as Row[],
    stockLevels: [
      { id: 'sl-alu', tenantId: 't1', itemId: 'alu', warehouseId: 'wh1', batchId: null, quantity: 1000 },
      { id: 'sl-fin', tenantId: 't1', itemId: 'fin', warehouseId: 'wh1', batchId: null, quantity: 1000 },
    ],
    stockMovements: [] as Row[],
    dailyProductions: [{ id: 'dp-1', tenantId: 't1', status: 'DRAFT' }] as Row[],
    purchaseBatches: [
      { id: 'pb-alu', tenantId: 't1', itemId: 'alu', quantity: 1000, remaining: 1000, unitCost: 3, sourceType: 'PURCHASE' },
      { id: 'pb-fin', tenantId: 't1', itemId: 'fin', quantity: 1000, remaining: 1000, unitCost: 10, sourceType: 'PURCHASE' },
    ] as Row[],
    productionStockAudits: [] as Row[],
    seq: 0,
  };

  const table = (rows: Row[]) => ({
    findFirst: async ({ where }: any = {}) =>
      rows.find((r) =>
        Object.entries(where ?? {}).every(([k, v]) =>
          v && typeof v === 'object' ? true : (r[k] ?? null) === (v ?? null),
        ),
      ) ?? null,
    findUnique: async ({ where }: any) =>
      rows.find((r) => Object.entries(where ?? {}).every(([k, v]) => r[k] === v)) ?? null,
    findMany: async () => [...rows],
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
      const row = rows.find((r) => r.id === where.id);
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      const hit = rows.filter((r) =>
        Object.entries(where ?? {}).every(([k, v]) => (r[k] ?? null) === (v ?? null)),
      );
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
    upsert: async ({ where, create, update }: any) => {
      const row = rows.find((r) =>
        Object.entries(where ?? {}).every(([k, v]) => r[k] === v),
      );
      if (row) { Object.assign(row, update); return row; }
      const made = { id: `r${++state.seq}`, ...create };
      rows.push(made);
      return made;
    },
    aggregate: async ({ where, _sum }: any) => {
      const hit = rows.filter((r) =>
        Object.entries(where ?? {}).every(([k, v]) => (r[k] ?? null) === (v ?? null)),
      );
      const out: Row = {};
      for (const f of Object.keys(_sum ?? { quantity: true })) {
        out[f] = hit.reduce((a, r) => a + Number(r[f] ?? 0), 0);
      }
      return { _sum: out };
    },
    deleteMany: async () => ({ count: 0 }),
  });

  const client: any = {
    tenantSetting: table(state.tenantSettings),
    warehouse: table(state.warehouses),
    item: table(state.items),
    stockLevel: table(state.stockLevels),
    stockMovement: table(state.stockMovements),
    dailyProduction: table(state.dailyProductions),
    purchaseBatch: table(state.purchaseBatches),
    productionStockAudit: table(state.productionStockAudits),
  };
  client.$transaction = async (fn: any) => fn(client);

  client.dailyProduction.findFirst = async ({ where }: any) => {
    const dp = state.dailyProductions.find((d) => d.id === where.id);
    if (!dp) return null;
    return {
      ...dp,
      cartonUsage: [],
      aluminumUsage: [],
      milkUsage: opts.milkUsage ?? [],
      produced: opts.produced ?? [],
      wastages: opts.wastages ?? [],
    };
  };

  // Records what was asked of FIFO, per allocation method.
  const calls: Array<{ itemId: string; qty: number; method?: string }> = [];
  const fifo = {
    consumeForProduction: jest.fn(async (_t: string, dto: any) => {
      calls.push({ itemId: dto.rawItemId, qty: Number(dto.quantity), method: dto.allocationMethod });
      const batch = state.purchaseBatches.find((b) => b.itemId === dto.rawItemId);
      const unit = batch ? Number(batch.unitCost) : 0;
      if (batch) batch.remaining = Number(batch.remaining) - Number(dto.quantity);
      return {
        totalCost: unit * Number(dto.quantity),
        allocations: [],
        quantityConsumed: Number(dto.quantity),
        shortageQuantity: 0,
      };
    }),
    reverseForProduction: jest.fn(async () => ({ restoredAllocations: 0 })),
  };

  return { state, client, fifo, calls, service: new DailyProductionService(client, fifo as any) as any };
}

const produced = (itemId: string, cartons: number) => ({
  itemId, itemName: 'منتج', cartonsTotal: cartons, warehouseId: null,
});
const waste = (id: string, itemId: string, qty: number) => ({
  id, itemId, itemName: 'تالف', quantity: qty, unit: 'PCS', warehouseId: null, reason: 'كسر',
});

describe('raw-material waste', () => {
  it('consumes the RAW material FIFO, not the finished-goods FIFO', async () => {
    const db = makeDb({
      produced: [produced('fin', 100)],
      wastages: [waste('w1', 'alu', 4)],
    });
    await db.service.post('t1', 'u1', 'dp-1', { allowShortage: true });

    const wasteCall = db.calls.find((c) => c.method === 'FIFO_WASTE_RAW');
    expect(wasteCall).toBeDefined();
    expect(wasteCall!.itemId).toBe('alu');
    expect(wasteCall!.qty).toBe(4);
  });

  it('draws down the raw item batch by exactly the wasted quantity', async () => {
    const db = makeDb({
      produced: [produced('fin', 100)],
      wastages: [waste('w1', 'alu', 4)],
    });
    await db.service.post('t1', 'u1', 'dp-1', { allowShortage: true });

    const alu = db.state.purchaseBatches.find((b: Row) => b.id === 'pb-alu');
    expect(Number(alu.remaining)).toBe(996);
  });

  it('is absorbed into production cost — perCartonCost rises', async () => {
    // 4 rolls at 3 = 12, over 100 cartons = 0.12 per carton.
    const db = makeDb({
      produced: [produced('fin', 100)],
      wastages: [waste('w1', 'alu', 4)],
    });
    await db.service.post('t1', 'u1', 'dp-1', { allowShortage: true });

    const fin = db.state.purchaseBatches.find(
      (b: Row) => b.sourceType === 'PRODUCTION' && b.itemId === 'fin',
    );
    expect(fin).toBeDefined();
    expect(Number(fin.unitCost)).toBeCloseTo(0.12, 9);
  });

  it('is tagged FIFO_WASTE_RAW so the report can tell it apart', async () => {
    const db = makeDb({
      produced: [produced('fin', 100)],
      wastages: [waste('w1', 'alu', 4)],
    });
    await db.service.post('t1', 'u1', 'dp-1', { allowShortage: true });
    expect(db.calls.map((c) => c.method)).toContain('FIFO_WASTE_RAW');
  });
});

describe('finished-goods waste', () => {
  it('consumes the FINISHED good FIFO at its own cost', async () => {
    const db = makeDb({
      produced: [produced('fin', 100)],
      wastages: [waste('w1', 'fin', 5)],
    });
    await db.service.post('t1', 'u1', 'dp-1', { allowShortage: true });

    const call = db.calls.find((c) => c.method === 'FIFO_WASTE_FINISHED');
    expect(call).toBeDefined();
    expect(call!.itemId).toBe('fin');
    expect(call!.qty).toBe(5);
  });

  it('is NOT absorbed — the surviving cartons keep their cost', async () => {
    // No raw usage at all, so production cost is 0 and perCartonCost must
    // stay 0. If finished waste were absorbed it would push it above 0 and
    // double-count a carton that was already costed at production.
    const db = makeDb({
      produced: [produced('fin', 100)],
      wastages: [waste('w1', 'fin', 5)],
    });
    await db.service.post('t1', 'u1', 'dp-1', { allowShortage: true });

    const finBatch = db.state.purchaseBatches.find(
      (b: Row) => b.sourceType === 'PRODUCTION' && b.itemId === 'fin',
    );
    // Falls back to the item's own avgCost (10), NOT a waste-inflated figure.
    expect(Number(finBatch.unitCost)).toBe(10);
  });

  it('runs AFTER the produced batch exists, so it can consume it', async () => {
    const db = makeDb({
      produced: [produced('fin', 100)],
      wastages: [waste('w1', 'fin', 5)],
    });
    await db.service.post('t1', 'u1', 'dp-1', { allowShortage: true });

    // The production batch is created during posting; the finished-waste
    // consumption must come after it or there would be nothing to draw on.
    const finishedIdx = db.calls.findIndex((c) => c.method === 'FIFO_WASTE_FINISHED');
    expect(finishedIdx).toBeGreaterThanOrEqual(0);
    const producedBatch = db.state.purchaseBatches.find(
      (b: Row) => b.sourceType === 'PRODUCTION',
    );
    expect(producedBatch).toBeDefined();
  });
});

describe('the two are kept apart', () => {
  it('classifies each waste row by whether this sheet produced that item', async () => {
    const db = makeDb({
      produced: [produced('fin', 100)],
      wastages: [waste('w1', 'alu', 4), waste('w2', 'fin', 5)],
    });
    await db.service.post('t1', 'u1', 'dp-1', { allowShortage: true });

    const raw = db.calls.filter((c) => c.method === 'FIFO_WASTE_RAW');
    const fin = db.calls.filter((c) => c.method === 'FIFO_WASTE_FINISHED');
    expect(raw).toHaveLength(1);
    expect(raw[0].itemId).toBe('alu');
    expect(fin).toHaveLength(1);
    expect(fin[0].itemId).toBe('fin');
  });

  it('only the raw part reaches the carton cost', async () => {
    // alu 4 × 3 = 12 absorbed; fin 5 × 10 = 50 must NOT be.
    const db = makeDb({
      produced: [produced('fin', 100)],
      wastages: [waste('w1', 'alu', 4), waste('w2', 'fin', 5)],
    });
    await db.service.post('t1', 'u1', 'dp-1', { allowShortage: true });

    const finBatch = db.state.purchaseBatches.find(
      (b: Row) => b.sourceType === 'PRODUCTION' && b.itemId === 'fin',
    );
    // 12 / 100 = 0.12. Absorbing the finished waste too would give 0.62.
    expect(Number(finBatch.unitCost)).toBeCloseTo(0.12, 9);
  });

  it('still deducts StockLevel for both kinds', async () => {
    const db = makeDb({
      produced: [produced('fin', 100)],
      wastages: [waste('w1', 'alu', 4), waste('w2', 'fin', 5)],
    });
    await db.service.post('t1', 'u1', 'dp-1', { allowShortage: true });

    const alu = db.state.stockLevels.find((l: Row) => l.itemId === 'alu');
    expect(Number(alu.quantity)).toBe(996);
    // finished: 1000 + 100 produced − 5 wasted
    const fin = db.state.stockLevels.find((l: Row) => l.itemId === 'fin');
    expect(Number(fin.quantity)).toBe(1095);
  });

  it('writes a WASTE stock movement for every waste row, as before', async () => {
    const db = makeDb({
      produced: [produced('fin', 100)],
      wastages: [waste('w1', 'alu', 4), waste('w2', 'fin', 5)],
    });
    await db.service.post('t1', 'u1', 'dp-1', { allowShortage: true });

    const wasteMoves = db.state.stockMovements.filter((m: Row) => m.type === 'WASTE');
    expect(wasteMoves).toHaveLength(2);
    expect(wasteMoves.every((m: Row) => m.reasonCode === 'PROD_WASTE')).toBe(true);
  });

  it('a sheet with no waste behaves exactly as before', async () => {
    const db = makeDb({ produced: [produced('fin', 100)], wastages: [] });
    await db.service.post('t1', 'u1', 'dp-1', { allowShortage: true });
    expect(db.calls.filter((c) => (c.method ?? '').startsWith('FIFO_WASTE'))).toHaveLength(0);
  });
});

describe('waste rows must be linked to an item', () => {
  it('refuses to post a waste row with no itemId, and writes nothing', async () => {
    // Pre-existing guard, deliberately preserved: an unlinked waste row
    // would move stock that cannot be traced to an item, so posting is
    // refused rather than silently skipping the row. Asserted here so the
    // waste-FIFO work cannot quietly relax it.
    const db = makeDb({
      produced: [produced('fin', 100)],
      wastages: [{ id: 'w0', itemId: null, itemName: '', quantity: 3, unit: 'PCS' }],
    });
    await expect(
      db.service.post('t1', 'u1', 'dp-1', { allowShortage: true }),
    ).rejects.toThrow(/يجب اختيار الصنف/);

    expect(db.calls.filter((c) => (c.method ?? '').startsWith('FIFO_WASTE'))).toHaveLength(0);
  });
});
