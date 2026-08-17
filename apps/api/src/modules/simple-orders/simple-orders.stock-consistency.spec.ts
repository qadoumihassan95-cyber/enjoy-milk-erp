import { SimpleOrdersService } from './simple-orders.service';

/**
 * Stage 4.1 — sales must not lose inventory silently.
 *
 * Two branches swallowed quantity:
 *
 *   deductStock  `Math.max(0, newQty)` clamped the balance at zero while
 *                the order still billed the full quantity and FIFO still
 *                consumed the full quantity. The difference vanished.
 *   adjustStock  `else if (delta > 0)` dropped negative deltas whenever no
 *                StockLevel row existed yet.
 *
 * Either way StockLevel ended up describing less consumption than actually
 * happened, and the reconciliation report saw drift with no source.
 *
 * A negative balance is the correct outcome here: the sale really occurred.
 * Same reasoning as WARNING_MODE in production posting — record the
 * shortfall, do not hide it.
 */

type Row = Record<string, any>;

function makeDb(levels: Row[] = []) {
  const state = { levels: [...levels], seq: 0 };
  const tx: any = {
    stockLevel: {
      findFirst: async ({ where }: any) =>
        state.levels.find(
          (l) =>
            l.itemId === where.itemId &&
            l.warehouseId === where.warehouseId &&
            (l.batchId ?? null) === (where.batchId ?? null),
        ) ?? null,
      update: async ({ where, data }: any) => {
        const row = state.levels.find((l) => l.id === where.id);
        row.quantity = Number(data.quantity);
        return row;
      },
      create: async ({ data }: any) => {
        const row = { id: `sl${++state.seq}`, ...data, quantity: Number(data.quantity) };
        state.levels.push(row);
        return row;
      },
    },
  };
  return { state, tx, service: new SimpleOrdersService({} as any, {} as any) as any };
}

const level = (quantity: number): Row => ({
  id: 'sl0', tenantId: 't1', itemId: 'i1', warehouseId: 'wh1', batchId: null, quantity,
});

describe('deductStock records the full deduction', () => {
  it('deducts normally when stock covers the sale', async () => {
    const { state, tx, service } = makeDb([level(100)]);
    await service.deductStock(tx, 't1', 'i1', 'wh1', 30);
    expect(state.levels[0].quantity).toBe(70);
  });

  it('goes negative rather than clamping at zero — the sale really happened', async () => {
    const { state, tx, service } = makeDb([level(20)]);
    await service.deductStock(tx, 't1', 'i1', 'wh1', 50);
    // Old behaviour: 0, and 30 units of consumption lost with no record.
    expect(state.levels[0].quantity).toBe(-30);
  });

  it('materialises a row when none exists instead of doing nothing', async () => {
    const { state, tx, service } = makeDb([]);
    await service.deductStock(tx, 't1', 'i1', 'wh1', 15);
    expect(state.levels).toHaveLength(1);
    expect(state.levels[0].quantity).toBe(-15);
    expect(state.levels[0].tenantId).toBe('t1');
  });

  it('drains to exactly zero without creating a phantom negative', async () => {
    const { state, tx, service } = makeDb([level(40)]);
    await service.deductStock(tx, 't1', 'i1', 'wh1', 40);
    expect(state.levels[0].quantity).toBe(0);
  });
});

describe('adjustStock applies negative deltas even with no existing row', () => {
  it('applies a positive delta to an existing row', async () => {
    const { state, tx, service } = makeDb([level(10)]);
    await service.adjustStock(tx, 't1', 'i1', 'wh1', 5);
    expect(state.levels[0].quantity).toBe(15);
  });

  it('applies a negative delta to an existing row', async () => {
    const { state, tx, service } = makeDb([level(10)]);
    await service.adjustStock(tx, 't1', 'i1', 'wh1', -4);
    expect(state.levels[0].quantity).toBe(6);
  });

  it('creates the row for a positive delta', async () => {
    const { state, tx, service } = makeDb([]);
    await service.adjustStock(tx, 't1', 'i1', 'wh1', 7);
    expect(state.levels[0].quantity).toBe(7);
  });

  it('creates the row for a NEGATIVE delta — previously dropped silently', async () => {
    const { state, tx, service } = makeDb([]);
    await service.adjustStock(tx, 't1', 'i1', 'wh1', -7);
    expect(state.levels).toHaveLength(1);
    expect(state.levels[0].quantity).toBe(-7);
  });

  it('a zero delta writes nothing at all', async () => {
    const { state, tx, service } = makeDb([]);
    await service.adjustStock(tx, 't1', 'i1', 'wh1', 0);
    expect(state.levels).toHaveLength(0);
  });
});

describe('the deduction matches what FIFO and the order consumed', () => {
  it('balance change equals the sold quantity exactly, whatever the starting balance', async () => {
    for (const [start, sold, expected] of [
      [100, 30, 70],
      [20, 50, -30],
      [0, 5, -5],
    ] as const) {
      const { state, tx, service } = makeDb([level(start)]);
      await service.deductStock(tx, 't1', 'i1', 'wh1', sold);
      expect(state.levels[0].quantity).toBe(expected);
      // The invariant that was broken: StockLevel moved by exactly `sold`.
      expect(start - state.levels[0].quantity).toBe(sold);
    }
  });
});
