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
