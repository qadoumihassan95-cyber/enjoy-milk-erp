import { FifoCostingService } from './fifo.service';
import { ConflictException, BadRequestException } from '@nestjs/common';

/**
 * Unit-level guards for the concurrency fix.
 *
 * These do NOT prove the concurrency property — a JS mock cannot
 * interleave transactions. That proof lives in
 * apps/api/test/fifo-concurrency.int.js, which runs two real
 * transactions against real PostgreSQL.
 *
 * What these DO pin down is that the service still issues the
 * statements the proof depends on: the lock is taken, it is taken
 * before the read, the ordering is total, and the write is a guarded
 * relative decrement rather than an absolute value computed here.
 * If someone "simplifies" one of those back, these fail.
 */

type Batch = {
  id: string;
  tenantId: string;
  itemId: string;
  purchaseDate: Date;
  createdAt: Date;
  remaining: any;
  unitCost: any;
  sourceType?: string;
};

function makeClient(batches: Batch[]) {
  const calls: string[] = [];
  const rawSql: string[] = [];
  const updateArgs: any[] = [];

  const store = new Map(batches.map((b) => [b.id, { ...b }]));

  const client: any = {
    $queryRaw: jest.fn((strings: TemplateStringsArray, ..._v: any[]) => {
      const sql = Array.isArray(strings) ? strings.join('?') : String(strings);
      rawSql.push(sql);
      calls.push('LOCK');
      return Promise.resolve([...store.values()].map((b) => ({ id: b.id })));
    }),
    purchaseBatch: {
      findMany: jest.fn(async () => {
        calls.push('READ');
        return [...store.values()]
          .filter((b) => Number(b.remaining) > 0)
          .sort(
            (a, b) =>
              a.purchaseDate.getTime() - b.purchaseDate.getTime() ||
              a.createdAt.getTime() - b.createdAt.getTime() ||
              (a.id < b.id ? -1 : 1),
          );
      }),
      // Faithfully models `remaining >= qty` guard + relative decrement.
      updateMany: jest.fn(async (args: any) => {
        calls.push('UPDATE');
        updateArgs.push(args);
        const row = store.get(args.where.id);
        if (!row) return { count: 0 };
        if (args.where.remaining?.gte !== undefined) {
          if (Number(row.remaining) < Number(args.where.remaining.gte)) {
            return { count: 0 };
          }
        }
        if (args.data.remaining?.decrement !== undefined) {
          row.remaining = Number(row.remaining) - Number(args.data.remaining.decrement);
        } else if (args.data.remaining?.increment !== undefined) {
          row.remaining = Number(row.remaining) + Number(args.data.remaining.increment);
        }
        return { count: 1 };
      }),
      create: jest.fn(async ({ data }: any) => ({ id: 'shortage-1', ...data })),
      deleteMany: jest.fn(async () => ({ count: 0 })),
      findUnique: jest.fn(async ({ where }: any) => store.get(where.id) ?? null),
    },
    productionCostAllocation: {
      create: jest.fn(async ({ data }: any) => ({ id: `pa-${updateArgs.length}`, ...data })),
      findMany: jest.fn(async () => []),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
    saleCostAllocation: {
      create: jest.fn(async ({ data }: any) => ({ id: 'sa-1', ...data })),
      findMany: jest.fn(async () => []),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
    item: { findUnique: jest.fn(async () => ({ avgCost: 2, costPrice: 2 })) },
  };

  return { client, calls, rawSql, updateArgs, store };
}

const batch = (id: string, remaining: number, day = '2026-01-01'): Batch => ({
  id,
  tenantId: 't1',
  itemId: 'item-1',
  purchaseDate: new Date(day),
  createdAt: new Date(day),
  remaining,
  unitCost: 3,
});

const svc = () => new FifoCostingService({} as any);

describe('FIFO consumption takes a real row lock', () => {
  it('issues SELECT … FOR UPDATE before reading the batches', async () => {
    const { client, calls, rawSql } = makeClient([batch('b1', 100)]);
    await svc().consumeForProduction(
      't1',
      { dailyProductionId: 'dp1', rawItemId: 'item-1', quantity: 10 },
      client,
    );
    expect(calls[0]).toBe('LOCK');
    expect(calls[1]).toBe('READ');
    expect(rawSql.join(' ')).toMatch(/FOR UPDATE/i);
  });

  it('does NOT use SKIP LOCKED — that would break FIFO order', async () => {
    const { client, rawSql } = makeClient([batch('b1', 100)]);
    await svc().consumeForProduction(
      't1',
      { dailyProductionId: 'dp1', rawItemId: 'item-1', quantity: 10 },
      client,
    );
    expect(rawSql.join(' ')).not.toMatch(/SKIP LOCKED/i);
  });

  it('orders by purchaseDate, createdAt AND id so the lock order is total', async () => {
    const { client, rawSql } = makeClient([batch('b1', 100)]);
    await svc().consumeForProduction(
      't1',
      { dailyProductionId: 'dp1', rawItemId: 'item-1', quantity: 10 },
      client,
    );
    const sql = rawSql.join(' ').replace(/\s+/g, ' ');
    expect(sql).toMatch(/ORDER BY "purchaseDate" ASC, "createdAt" ASC, id ASC/);
  });

  it('locks on the sale path too', async () => {
    const { client, rawSql } = makeClient([batch('b1', 100)]);
    await svc().consumeForSale(
      't1',
      { saleOrderId: 'so1', itemId: 'item-1', quantity: 5 },
      client,
    );
    expect(rawSql.join(' ')).toMatch(/FOR UPDATE/i);
  });
});

describe('the decrement is relative and guarded, not an absolute write', () => {
  it('uses decrement with a remaining >= take predicate', async () => {
    const { client, updateArgs } = makeClient([batch('b1', 100)]);
    await svc().consumeForProduction(
      't1',
      { dailyProductionId: 'dp1', rawItemId: 'item-1', quantity: 40 },
      client,
    );
    expect(updateArgs).toHaveLength(1);
    expect(Number(updateArgs[0].data.remaining.decrement)).toBe(40);
    expect(Number(updateArgs[0].where.remaining.gte)).toBe(40);
    // The old defect: writing a value computed in JS.
    expect(updateArgs[0].data.remaining.set).toBeUndefined();
  });

  it('raises rather than over-consuming when the guard matches no row', async () => {
    const { client } = makeClient([batch('b1', 100)]);
    // Simulate the row having been drained by a concurrent transaction
    // between the read and the write.
    client.purchaseBatch.updateMany = jest.fn(async () => ({ count: 0 }));

    await expect(
      svc().consumeForProduction(
        't1',
        { dailyProductionId: 'dp1', rawItemId: 'item-1', quantity: 40 },
        client,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('never drives remaining below zero across sequential takes', async () => {
    const { client, store } = makeClient([batch('b1', 50), batch('b2', 50, '2026-02-01')]);
    await svc().consumeForProduction(
      't1',
      { dailyProductionId: 'dp1', rawItemId: 'item-1', quantity: 70 },
      client,
    );
    for (const b of store.values()) expect(Number(b.remaining)).toBeGreaterThanOrEqual(0);
    expect(Number(store.get('b1')!.remaining)).toBe(0);
    expect(Number(store.get('b2')!.remaining)).toBe(30);
  });

  it('still refuses a genuine shortage when allowShortage is not set', async () => {
    const { client } = makeClient([batch('b1', 10)]);
    await expect(
      svc().consumeForProduction(
        't1',
        { dailyProductionId: 'dp1', rawItemId: 'item-1', quantity: 40 },
        client,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('consumes oldest batch first', async () => {
    const { client, store } = makeClient([
      batch('newer', 50, '2026-06-01'),
      batch('older', 50, '2020-01-01'),
    ]);
    await svc().consumeForProduction(
      't1',
      { dailyProductionId: 'dp1', rawItemId: 'item-1', quantity: 30 },
      client,
    );
    expect(Number(store.get('older')!.remaining)).toBe(20);
    expect(Number(store.get('newer')!.remaining)).toBe(50);
  });
});

describe('reversal restores atomically', () => {
  it('uses increment rather than read-then-write', async () => {
    const { client, updateArgs } = makeClient([batch('b1', 40)]);
    client.productionCostAllocation.findMany = jest.fn(async () => [
      { batchId: 'b1', quantity: 60 },
    ]);

    await svc().reverseForProduction('t1', 'dp1', client);

    expect(updateArgs).toHaveLength(1);
    expect(Number(updateArgs[0].data.remaining.increment)).toBe(60);
    expect(updateArgs[0].data.remaining.set).toBeUndefined();
  });

  it('sale reversal also uses increment', async () => {
    const { client, updateArgs } = makeClient([batch('b1', 40)]);
    client.saleCostAllocation.findMany = jest.fn(async () => [
      { batchId: 'b1', quantity: 10 },
    ]);

    await svc().reverseForSale('t1', 'so1', client);

    expect(Number(updateArgs[0].data.remaining.increment)).toBe(10);
  });
});

describe('caller-side deterministic lock ordering', () => {
  it('daily-production sorts raw rows by itemId before consuming', () => {
    // Cross-item deadlock avoidance depends on this sort. Assert on the
    // source so removing it is a failing test, not a silent regression.
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const code = fs.readFileSync(
      path.join(__dirname, '..', 'daily-production', 'daily-production.service.ts'),
      'utf8',
    );
    expect(code).toMatch(/rawRows\.sort\(/);
  });
});
