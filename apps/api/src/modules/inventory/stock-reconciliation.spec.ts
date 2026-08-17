import { StockReconciliationService } from './stock-reconciliation.service';

/**
 * The reconciliation report is a diagnostic. Two things must hold:
 *   1. it finds the divergences that actually occurred in production;
 *   2. it never writes anything.
 *
 * (2) is asserted structurally — the mock throws on every mutating
 * method, so any future "helpful" repair fails the suite immediately.
 */

type Row = Record<string, any>;

function makeDb(seed: {
  items?: Row[];
  stockLevels?: Row[];
  batches?: Row[];
  movements?: Row[];
  milk?: Row[];
  waste?: Row[];
  allocations?: Row[];
}) {
  const items = seed.items ?? [];
  const stockLevels = seed.stockLevels ?? [];
  const batches = seed.batches ?? [];

  const forbidden = (table: string, op: string) => () => {
    throw new Error(`WRITE ATTEMPTED: ${table}.${op} — this service must be read-only`);
  };

  const groupBy = (rows: Row[]) => async (args: any) => {
    const where = args?.where ?? {};
    const filtered = rows.filter((r) =>
      Object.entries(where).every(([k, v]) => {
        if (v && typeof v === 'object' && 'lt' in v) return Number(r[k]) < Number((v as any).lt);
        return r[k] === v;
      }),
    );
    const groups = new Map<string, Row[]>();
    for (const r of filtered) {
      const key = r[args.by[0]];
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    return [...groups.entries()].map(([key, rs]) => {
      const _sum: Row = {};
      for (const f of Object.keys(args?._sum ?? {})) {
        _sum[f] = rs.reduce((s, r) => s + Number(r[f] ?? 0), 0);
      }
      return { [args.by[0]]: key, _sum, _count: { _all: rs.length } };
    });
  };

  const table = (rows: Row[], name: string) => ({
    findMany: async (args: any) => {
      const where = args?.where ?? {};
      return rows.filter((r) =>
        Object.entries(where).every(([k, v]) => {
          if (v && typeof v === 'object' && 'lt' in v) return Number(r[k]) < Number((v as any).lt);
          return r[k] === v;
        }),
      );
    },
    groupBy: groupBy(rows),
    create: forbidden(name, 'create'),
    createMany: forbidden(name, 'createMany'),
    update: forbidden(name, 'update'),
    updateMany: forbidden(name, 'updateMany'),
    delete: forbidden(name, 'delete'),
    deleteMany: forbidden(name, 'deleteMany'),
    upsert: forbidden(name, 'upsert'),
  });

  return {
    item: table(items, 'item'),
    stockLevel: table(stockLevels, 'stockLevel'),
    purchaseBatch: table(batches, 'purchaseBatch'),
    // Stage 4.4 diagnostics read these. Empty by default so the existing
    // findings assertions are unaffected; the diagnostics suite below
    // seeds them explicitly.
    stockMovement: table(seed.movements ?? [], 'stockMovement'),
    productionMilkUsage: table(seed.milk ?? [], 'productionMilkUsage'),
    productionCartonUsage: table([], 'productionCartonUsage'),
    productionAluminumUsage: table([], 'productionAluminumUsage'),
    productionWaste: table(seed.waste ?? [], 'productionWaste'),
    productionCostAllocation: table(seed.allocations ?? [], 'productionCostAllocation'),
    $transaction: () => { throw new Error('WRITE ATTEMPTED: $transaction'); },
    $executeRaw: () => { throw new Error('WRITE ATTEMPTED: $executeRaw'); },
  } as any;
}

const item = (id: string, name: string, extra: Row = {}): Row => ({
  id, tenantId: 't1', sku: `SKU-${id}`, name, unit: 'KG', active: true, ...extra,
});
const level = (itemId: string, quantity: number, warehouseId = 'wh1'): Row => ({
  itemId, tenantId: 't1', warehouseId, quantity,
});
const batch = (itemId: string, remaining: number, extra: Row = {}): Row => ({
  itemId, tenantId: 't1', remaining, quantity: remaining, unitCost: 5,
  sourceType: 'PURCHASE', ...extra,
});

const run = (db: any, opts = {}) =>
  new StockReconciliationService(db).reconcile('t1', opts);

describe('the report is strictly read-only', () => {
  it('completes without invoking any mutating Prisma method', async () => {
    const db = makeDb({
      items: [item('a', 'صنف')],
      stockLevels: [level('a', 100)],
      batches: [batch('a', 100)],
    });
    await expect(run(db)).resolves.toBeDefined();
  });
});

describe('StockLevel without FIFO batches', () => {
  it('flags the raw-milk shape as CRITICAL', async () => {
    // The real one: StockLevel 40,000, FIFO 0.
    const db = makeDb({
      items: [item('milk', 'حليب خام')],
      stockLevels: [level('milk', 40000)],
      batches: [],
    });
    const res = await run(db);
    const f = res.findings.find((x) => x.check === 'STOCK_WITHOUT_BATCHES');

    expect(f).toBeDefined();
    expect(f!.severity).toBe('CRITICAL');
    expect(f!.stockLevel).toBe(40000);
    expect(f!.fifoRemaining).toBe(0);
    expect(f!.difference).toBe(40000);
  });

  it('stops reporting it once the opening batch exists', async () => {
    const db = makeDb({
      items: [item('milk', 'حليب خام')],
      stockLevels: [level('milk', 40000)],
      batches: [batch('milk', 40000, { sourceType: 'OPENING_BALANCE' })],
    });
    const res = await run(db);
    expect(res.findings.filter((f) => f.severity === 'CRITICAL')).toEqual([]);
  });
});

describe('FIFO batches without StockLevel', () => {
  it('flags batches that could be consumed against nothing', async () => {
    const db = makeDb({
      items: [item('x', 'صنف')],
      stockLevels: [],
      batches: [batch('x', 250)],
    });
    const res = await run(db);
    const f = res.findings.find((x) => x.check === 'BATCHES_WITHOUT_STOCK');

    expect(f?.severity).toBe('CRITICAL');
    expect(f?.fifoRemaining).toBe(250);
  });
});

describe('layer drift', () => {
  it('reports a positive drift as unconsumable balance', async () => {
    const db = makeDb({
      items: [item('x', 'صنف')],
      stockLevels: [level('x', 500)],
      batches: [batch('x', 300)],
    });
    const [f] = (await run(db)).findings.filter((x) => x.check === 'LAYER_DRIFT');

    expect(f.severity).toBe('WARNING');
    expect(f.difference).toBe(200);
    expect(f.detail).toContain('غير قابل للاستهلاك');
  });

  it('reports a negative drift as cost cover without balance', async () => {
    const db = makeDb({
      items: [item('x', 'صنف')],
      stockLevels: [level('x', 300)],
      batches: [batch('x', 500)],
    });
    const [f] = (await run(db)).findings.filter((x) => x.check === 'LAYER_DRIFT');
    expect(f.difference).toBe(-200);
  });

  it('tolerates decimal noise below 0.001', async () => {
    const db = makeDb({
      items: [item('x', 'صنف')],
      stockLevels: [level('x', 100.00005)],
      batches: [batch('x', 100)],
    });
    expect((await run(db)).findings.filter((f) => f.check === 'LAYER_DRIFT')).toEqual([]);
  });
});

describe('negative balances', () => {
  it('flags a negative warehouse row even when the item total is positive', async () => {
    const db = makeDb({
      items: [item('x', 'صنف')],
      stockLevels: [level('x', 500, 'wh1'), level('x', -50, 'wh2')],
      batches: [batch('x', 450)],
    });
    const f = (await run(db)).findings.find((x) => x.check === 'NEGATIVE_STOCK');

    expect(f?.severity).toBe('CRITICAL');
    expect(f?.detail).toContain('-50');
  });
});

describe('duplicate opening coverage', () => {
  it('flags an item with two OPENING_BALANCE batches', async () => {
    const db = makeDb({
      items: [item('x', 'صنف')],
      stockLevels: [level('x', 100)],
      batches: [
        batch('x', 50, { sourceType: 'OPENING_BALANCE' }),
        batch('x', 50, { sourceType: 'OPENING_BALANCE' }),
      ],
    });
    const f = (await run(db)).findings.find((x) => x.check === 'DUPLICATE_OPENING_BATCH');

    expect(f?.severity).toBe('CRITICAL');
    expect(f?.detail).toContain('2');
  });

  it('does not flag a single opening batch', async () => {
    const db = makeDb({
      items: [item('x', 'صنف')],
      stockLevels: [level('x', 100)],
      batches: [batch('x', 100, { sourceType: 'OPENING_BALANCE' })],
    });
    expect(
      (await run(db)).findings.filter((f) => f.check === 'DUPLICATE_OPENING_BATCH'),
    ).toEqual([]);
  });
});

describe('cost layer quality', () => {
  it('flags an item whose every open batch is zero-cost', async () => {
    const db = makeDb({
      items: [item('x', 'صنف')],
      stockLevels: [level('x', 100)],
      batches: [batch('x', 100, { unitCost: 0 })],
    });
    const f = (await run(db)).findings.find((x) => x.check === 'ZERO_COST_LAYER');

    expect(f?.severity).toBe('WARNING');
    expect(f?.detail).toContain('صفر');
  });

  it('downgrades to INFO when only some batches are zero-cost', async () => {
    const db = makeDb({
      items: [item('x', 'صنف')],
      stockLevels: [level('x', 200)],
      batches: [batch('x', 100, { unitCost: 0 }), batch('x', 100, { unitCost: 4 })],
    });
    const f = (await run(db)).findings.find((x) => x.check === 'PARTIAL_ZERO_COST');
    expect(f?.severity).toBe('INFO');
  });

  it('ignores unitCost on fully-consumed batches', async () => {
    const db = makeDb({
      items: [item('x', 'صنف')],
      stockLevels: [],
      batches: [batch('x', 0, { unitCost: 0 })],
    });
    expect((await run(db)).findings.filter((f) => f.check === 'ZERO_COST_LAYER')).toEqual([]);
  });
});

describe('totals, ordering and scope', () => {
  it('computes totals and FIFO valuation across items', async () => {
    const db = makeDb({
      items: [item('a', 'أ'), item('b', 'ب')],
      stockLevels: [level('a', 100), level('b', 40)],
      batches: [batch('a', 100, { unitCost: 2 }), batch('b', 40, { unitCost: 3 })],
    });
    const res = await run(db);

    expect(res.totals.stockLevelSum).toBe(140);
    expect(res.totals.fifoRemainingSum).toBe(140);
    expect(res.totals.fifoInventoryValue).toBe(320); // 100*2 + 40*3
    expect(res.totals.absoluteDrift).toBe(0);
  });

  it('sorts CRITICAL findings ahead of WARNING and INFO', async () => {
    const db = makeDb({
      items: [item('crit', 'حرج'), item('warn', 'تحذير')],
      stockLevels: [level('crit', 999), level('warn', 500)],
      batches: [batch('warn', 300)],
    });
    const res = await run(db);

    expect(res.findings[0].severity).toBe('CRITICAL');
    expect(res.summary.CRITICAL).toBeGreaterThan(0);
    expect(res.summary.WARNING).toBeGreaterThan(0);
  });

  it('excludes inactive items unless asked', async () => {
    const db = makeDb({
      items: [item('gone', 'موقوف', { active: false })],
      stockLevels: [level('gone', 100)],
      batches: [],
    });

    expect((await run(db)).scope.itemsExamined).toBe(0);
    const withInactive = await run(db, { includeInactive: true });
    expect(withInactive.scope.itemsExamined).toBe(1);
    expect(withInactive.findings[0].check).toBe('STOCK_WITHOUT_BATCHES');
  });

  it('returns a clean report for a healthy tenant', async () => {
    const db = makeDb({
      items: [item('a', 'أ')],
      stockLevels: [level('a', 100)],
      batches: [batch('a', 100)],
    });
    const res = await run(db);

    expect(res.summary.CRITICAL).toBe(0);
    expect(res.summary.WARNING).toBe(0);
    expect(res.tenantId).toBe('t1');
  });
});

describe('the SQL twin stays read-only', () => {
  it('ops/RECONCILE-stock-model.sql contains no write statements', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const sql = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', '..', '..', 'ops', 'RECONCILE-stock-model.sql'),
      'utf8',
    );
    // Strip comment lines first — the header explains what it does NOT do.
    const code = sql
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');

    for (const verb of ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'TRUNCATE', 'CREATE']) {
      expect(code.toUpperCase()).not.toMatch(new RegExp(`\\b${verb}\\s+`, 'i'));
    }
  });
});

// ═════════════════════════════════════════════════════════════════════
//  Stage 4.4 — row-level diagnostics
// ═════════════════════════════════════════════════════════════════════

describe('conversion mismatch', () => {
  it('flags a waste row whose unit disagrees with the item — the live 300 "L" on a PCS item', async () => {
    const db = makeDb({
      items: [item('p', 'حليب 1 لتر', { unit: 'PCS' })],
      stockLevels: [level('p', 100)],
      batches: [batch('p', 100)],
      waste: [{ id: 'w1', tenantId: 't1', itemId: 'p', quantity: 300, unit: 'L', dailyProductionId: 'dp1' }],
    });
    const d = (await run(db)).diagnostics.conversionMismatch;

    expect(d).toHaveLength(1);
    expect(d[0].source).toBe('wastage');
    expect(d[0].rowUnit).toBe('L');
    expect(d[0].itemUnit).toBe('PCS');
    expect(d[0].quantity).toBe(300);
  });

  it('flags a row the converter gave up on', async () => {
    const db = makeDb({
      items: [item('r', 'رول', { unit: 'ROLL' })],
      milk: [{ id: 'm1', tenantId: 't1', itemId: 'r', quantity: 5, unit: 'ROLL', factorSource: 'UNCONVERTIBLE', dailyProductionId: 'dp1' }],
    });
    const d = (await run(db)).diagnostics.conversionMismatch;
    expect(d.map((x: any) => x.factorSource)).toContain('UNCONVERTIBLE');
  });

  it('says nothing when units agree', async () => {
    const db = makeDb({
      items: [item('k', 'حليب خام', { unit: 'KG' })],
      milk: [{ id: 'm1', tenantId: 't1', itemId: 'k', quantity: 100, unit: 'KG', factorSource: 'ITEM', dailyProductionId: 'dp1' }],
    });
    expect((await run(db)).diagnostics.conversionMismatch).toEqual([]);
  });
});

describe('legacy conversion factor', () => {
  it('lists items still relying on the 25 kg fallback', async () => {
    const db = makeDb({
      items: [item('k', 'حليب خام', { unit: 'KG', bagWeightKg: null })],
      milk: [
        { id: 'm1', tenantId: 't1', itemId: 'k', quantity: 100, unit: 'KG', factorSource: 'LEGACY_DEFAULT', dailyProductionId: 'dp1' },
        { id: 'm2', tenantId: 't1', itemId: 'k', quantity: 50, unit: 'KG', factorSource: 'LEGACY_DEFAULT', dailyProductionId: 'dp2' },
      ],
    });
    const d = (await run(db)).diagnostics.legacyFactorItems;

    expect(d).toHaveLength(1);
    expect(d[0].itemId).toBe('k');
    expect(d[0].rows).toBe(2);
    expect(d[0].bagWeightKg).toBeNull();
  });

  it('says nothing once the item carries its own factor', async () => {
    const db = makeDb({
      items: [item('k', 'حليب خام', { unit: 'KG', bagWeightKg: 30 })],
      milk: [{ id: 'm1', tenantId: 't1', itemId: 'k', quantity: 300, unit: 'KG', factorSource: 'ITEM', dailyProductionId: 'dp1' }],
    });
    expect((await run(db)).diagnostics.legacyFactorItems).toEqual([]);
  });
});

describe('movement ledger mismatch', () => {
  it('flags a balance that its own movements cannot explain', async () => {
    // The ×100 shape: ledger says 2,117, balance says 211,700.
    const db = makeDb({
      items: [item('x', 'صنف')],
      stockLevels: [level('x', 211700)],
      batches: [batch('x', 211700)],
      movements: [{ itemId: 'x', tenantId: 't1', type: 'IN', quantity: 2117 }],
    });
    const d = (await run(db)).diagnostics.ledgerMismatch;

    expect(d).toHaveLength(1);
    expect(d[0].stockLevel).toBe(211700);
    expect(d[0].netFromMovements).toBe(2117);
    expect(d[0].unexplained).toBe(209583);
  });

  it('nets OUT movements against IN', async () => {
    const db = makeDb({
      items: [item('x', 'صنف')],
      stockLevels: [level('x', 70)],
      batches: [batch('x', 70)],
      movements: [
        { itemId: 'x', tenantId: 't1', type: 'IN', quantity: 100 },
        { itemId: 'x', tenantId: 't1', type: 'OUT', quantity: 30 },
      ],
    });
    expect((await run(db)).diagnostics.ledgerMismatch).toEqual([]);
  });

  it('sorts the biggest unexplained gap first', async () => {
    const db = makeDb({
      items: [item('small', 'صغير'), item('big', 'كبير')],
      stockLevels: [level('small', 110), level('big', 5000)],
      batches: [batch('small', 110), batch('big', 5000)],
      movements: [
        { itemId: 'small', tenantId: 't1', type: 'IN', quantity: 100 },
        { itemId: 'big', tenantId: 't1', type: 'IN', quantity: 100 },
      ],
    });
    const d = (await run(db)).diagnostics.ledgerMismatch;
    expect(d[0].itemId).toBe('big');
  });
});

describe('waste with no measured cost', () => {
  it('flags a sheet that recorded waste but has no waste allocation', async () => {
    const db = makeDb({
      items: [item('x', 'صنف')],
      waste: [{ id: 'w1', tenantId: 't1', itemId: 'x', quantity: 5, unit: 'KG', dailyProductionId: 'dp-old' }],
      allocations: [{ tenantId: 't1', dailyProductionId: 'dp-old', method: 'FIFO' }],
    });
    const d = (await run(db)).diagnostics.wasteCostMissing;

    expect(d).toHaveLength(1);
    expect(d[0].dailyProductionId).toBe('dp-old');
    expect(d[0].wasteQuantity).toBe(5);
  });

  it('says nothing once waste consumed FIFO', async () => {
    const db = makeDb({
      items: [item('x', 'صنف')],
      waste: [{ id: 'w1', tenantId: 't1', itemId: 'x', quantity: 5, unit: 'KG', dailyProductionId: 'dp-new' }],
      allocations: [
        { tenantId: 't1', dailyProductionId: 'dp-new', method: 'FIFO' },
        { tenantId: 't1', dailyProductionId: 'dp-new', method: 'FIFO_WASTE_RAW' },
      ],
    });
    expect((await run(db)).diagnostics.wasteCostMissing).toEqual([]);
  });
});
