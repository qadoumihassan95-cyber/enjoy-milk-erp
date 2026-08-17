/**
 * Production posting modes — STRICT / WARNING / OVERRIDE.
 *
 * BEHAVIOUR BEING LOCKED IN
 * -------------------------
 * A raw-material shortage used to abort the posting with a 400, which in
 * a real factory is the wrong default: the material was physically
 * consumed and the inventory correction lands later. Posting behaviour is
 * now a tenant setting, and a shortage never produces an unhandled error.
 *
 * The confirmation contract, which these tests pin down:
 *   1st call, shortage present → 200 { success:false, requiresConfirmation:true,
 *                                      warnings:[...] } and ZERO writes.
 *   2nd call with allowShortage → { success:true, warnings:[...] }, balance
 *                                 goes negative, audit rows written.
 */

import { DailyProductionService } from './daily-production.service';

type Row = Record<string, any>;

function makeDb(opts: { mode?: string; aluStock?: number } = {}) {
  const state = {
    tenantSettings: opts.mode
      ? [{ id: 'ts', tenantId: 't1', productionPostingMode: opts.mode }]
      : ([] as Row[]),
    warehouses: [{ id: 'wh-main', tenantId: 't1', code: 'MAIN', active: true }] as Row[],
    items: [
      { id: 'alu', tenantId: 't1', name: 'ألمنيوم', avgCost: 3, costPrice: 2 },
      { id: 'fin', tenantId: 't1', name: 'منتج نهائي', avgCost: 10, costPrice: 9 },
    ] as Row[],
    stockLevels: [
      { id: 'sl-alu', tenantId: 't1', itemId: 'alu', warehouseId: 'wh-main', batchId: null, quantity: opts.aluStock ?? 5 },
    ] as Row[],
    stockMovements: [] as Row[],
    dailyProductions: [
      { id: 'dp-1', tenantId: 't1', status: 'DRAFT' },
    ] as Row[],
    purchaseBatches: [] as Row[],
    productionCostAllocations: [] as Row[],
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
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      const hit = rows.filter((r) =>
        Object.entries(where ?? {}).every(([k, v]) => r[k] === v),
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
    aggregate: async ({ where }: any) => {
      const sum = rows
        .filter((r) =>
          Object.entries(where ?? {}).every(([k, v]) => (r[k] ?? null) === (v ?? null)),
        )
        .reduce((a, r) => a + Number(r.quantity ?? 0), 0);
      return { _sum: { quantity: sum } };
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
    productionCostAllocation: table(state.productionCostAllocations),
    productionStockAudit: table(state.productionStockAudits),
  };
  client.$transaction = async (fn: any) => fn(client);

  // The sheet the service reads back via get().
  client.dailyProduction.findFirst = async ({ where }: any) => {
    const dp = state.dailyProductions.find((d) => d.id === where.id);
    if (!dp) return null;
    return {
      ...dp,
      cartonUsage: [],
      aluminumUsage: [
        { id: 'a1', itemId: 'alu', itemName: 'ألمنيوم', quantity: 20, warehouseId: null },
      ],
      milkUsage: [],
      produced: [],
      wastages: [],
    };
  };

  const fifo = {
    consumeForProduction: jest.fn(async () => ({
      totalCost: 0, allocations: [], quantityConsumed: 0, shortageQuantity: 0,
    })),
    reverseForProduction: jest.fn(async () => ({ restoredAllocations: 0 })),
  };

  return { state, client, fifo };
}

const svcFor = (db: ReturnType<typeof makeDb>) =>
  new DailyProductionService(db.client as any, db.fifo as any);

describe('production posting modes', () => {
  it('STRICT_MODE still refuses a shortage with an insufficient-stock error', async () => {
    const db = makeDb({ mode: 'STRICT_MODE' });
    await expect(svcFor(db).post('t1', 'u1', 'dp-1')).rejects.toThrow(/المخزون لا يكفي/);

    expect(db.state.dailyProductions[0].status).toBe('DRAFT');
    expect(db.state.stockMovements).toHaveLength(0);
    expect(Number(db.state.stockLevels[0].quantity)).toBe(5); // untouched
  });

  it('WARNING_MODE is the default when the tenant has no settings row', async () => {
    const db = makeDb(); // no tenantSetting seeded
    const res: any = await svcFor(db).post('t1', 'u1', 'dp-1');
    expect(res.mode).toBe('WARNING_MODE');
  });

  it('first call returns requiresConfirmation and writes NOTHING', async () => {
    const db = makeDb({ mode: 'WARNING_MODE' });
    const res: any = await svcFor(db).post('t1', 'u1', 'dp-1');

    expect(res).toMatchObject({ success: false, requiresConfirmation: true });
    expect(res.warnings[0]).toMatchObject({
      type: 'INSUFFICIENT_STOCK',
      item: 'ألمنيوم',
      requiredQuantity: 20,
      availableQuantity: 5,
      shortageQuantity: 15,
    });

    // No side effects whatsoever.
    expect(db.state.dailyProductions[0].status).toBe('DRAFT');
    expect(db.state.stockMovements).toHaveLength(0);
    expect(db.state.productionStockAudits).toHaveLength(0);
    expect(Number(db.state.stockLevels[0].quantity)).toBe(5);
  });

  it('confirmed WARNING_MODE post succeeds, goes negative, and reports warnings', async () => {
    const db = makeDb({ mode: 'WARNING_MODE' });
    const res: any = await svcFor(db).post('t1', 'u1', 'dp-1', { allowShortage: true });

    expect(res.success).toBe(true);
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0].shortageQuantity).toBe(15);

    expect(db.state.dailyProductions[0].status).toBe('POSTED');
    expect(Number(db.state.stockLevels[0].quantity)).toBe(-15); // 5 − 20
  });

  it('writes an audit row with previous/resulting stock and a reason', async () => {
    const db = makeDb({ mode: 'WARNING_MODE' });
    await svcFor(db).post('t1', 'u1', 'dp-1', { allowShortage: true });

    expect(db.state.productionStockAudits).toHaveLength(1);
    const audit = db.state.productionStockAudits[0];
    expect(audit.itemName).toBe('ألمنيوم');
    expect(Number(audit.previousStock)).toBe(5);
    expect(Number(audit.resultingStock)).toBe(-15);
    expect(Number(audit.shortageQuantity)).toBe(15);
    expect(audit.warningType).toBe('INSUFFICIENT_STOCK');
    expect(audit.postedById).toBe('u1');
    expect(audit.reason).toMatch(/Negative stock created for item/);
  });

  it('passes allowShortage through to FIFO so costing still runs', async () => {
    const db = makeDb({ mode: 'WARNING_MODE' });
    await svcFor(db).post('t1', 'u1', 'dp-1', { allowShortage: true });

    expect(db.fifo.consumeForProduction).toHaveBeenCalled();
    const dto = (db.fifo.consumeForProduction as jest.Mock).mock.calls[0][1];
    expect(dto).toMatchObject({ rawItemId: 'alu', quantity: 20, allowShortage: true });
  });

  it('OVERRIDE_MODE rejects a non-privileged role with 403', async () => {
    const db = makeDb({ mode: 'OVERRIDE_MODE' });
    await expect(
      svcFor(db).post('t1', 'u1', 'dp-1', { allowShortage: true, userRole: 'OPERATOR' }),
    ).rejects.toThrow(/للمدراء فقط/);

    expect(db.state.dailyProductions[0].status).toBe('DRAFT');
    expect(Number(db.state.stockLevels[0].quantity)).toBe(5);
  });

  it.each(['OWNER', 'ADMIN', 'MANAGER'])(
    'OVERRIDE_MODE allows %s to post with a shortage',
    async (role) => {
      const db = makeDb({ mode: 'OVERRIDE_MODE' });
      const res: any = await svcFor(db).post('t1', 'u1', 'dp-1', {
        allowShortage: true,
        userRole: role,
      });
      expect(res.success).toBe(true);
      expect(Number(db.state.stockLevels[0].quantity)).toBe(-15);
    },
  );

  it('no shortage → posts straight through with an empty warnings array', async () => {
    const db = makeDb({ mode: 'WARNING_MODE', aluStock: 500 });
    const res: any = await svcFor(db).post('t1', 'u1', 'dp-1');

    expect(res.success).toBe(true);
    expect(res.warnings).toEqual([]);
    expect(Number(db.state.stockLevels[0].quantity)).toBe(480);
    expect(db.state.dailyProductions[0].status).toBe('POSTED');
  });

  it('rejects an unsupported posting mode on write', async () => {
    const db = makeDb();
    await expect(svcFor(db).writePostingMode('t1', 'u1', 'YOLO_MODE')).rejects.toThrow(
      /وضع ترحيل غير مدعوم/,
    );
  });

  it('readPostingMode reports the stored mode and the available set', async () => {
    const db = makeDb({ mode: 'STRICT_MODE' });
    const res = await svcFor(db).readPostingMode('t1');
    expect(res.mode).toBe('STRICT_MODE');
    expect(res.availableModes).toEqual(['STRICT_MODE', 'WARNING_MODE', 'OVERRIDE_MODE']);
  });
});
