import { DailyProductionService } from './daily-production.service';

/**
 * Regression tests for detectShortages reading the authoritative model.
 *
 * The defect: detectShortages aggregated StockLevel only. Posting
 * consumes PurchaseBatch.remaining via FIFO. When the two layers
 * disagree — which they demonstrably do in production — no shortage was
 * reported, so STRICT_MODE did not block and WARNING_MODE did not warn.
 * The posting then failed from inside the transaction with a raw Arabic
 * FIFO message.
 *
 * The canonical case is real: حليب خام carried StockLevel 40,000 with
 * FIFO remaining 0 (an opening balance with no batch behind it).
 */

function makeService(opts: {
  stock: number;
  fifo: number;
  mode?: string;
}) {
  const prisma: any = {
    stockLevel: {
      aggregate: jest.fn(async () => ({ _sum: { quantity: opts.stock } })),
    },
    purchaseBatch: {
      aggregate: jest.fn(async () => ({ _sum: { remaining: opts.fifo } })),
    },
    tenantSetting: {
      findUnique: jest.fn(async () => ({
        tenantId: 't1',
        productionPostingMode: opts.mode ?? 'STRICT_MODE',
      })),
    },
  };
  return { service: new DailyProductionService(prisma, {} as any, {} as any, {} as any) as any, prisma };
}

const sheet = (qty: number) => ({
  id: 'dp1',
  cartonUsage: [],
  aluminumUsage: [],
  milkUsage: [{ itemId: 'raw-milk', itemName: 'حليب خام', quantity: qty }],
  wastages: [],
});

describe('detectShortages — the production case that slipped through', () => {
  it('detects a shortage when StockLevel is ample but FIFO is empty', async () => {
    // The exact live situation before the opening-balance backfill.
    const { service } = makeService({ stock: 40000, fifo: 0 });
    const out = await service.detectShortages('t1', sheet(500));

    expect(out).toHaveLength(1);
    expect(out[0].requiredQuantity).toBe(500);
    expect(out[0].availableQuantity).toBe(0);
    expect(out[0].shortageQuantity).toBe(500);
  });

  it('names FIFO batches as the limiting layer, not the balance', async () => {
    const { service } = makeService({ stock: 40000, fifo: 0 });
    const [s] = await service.detectShortages('t1', sheet(500));

    expect(s.limitedBy).toBe('FIFO_BATCHES');
    expect(s.stockLevelAvailable).toBe(40000);
    expect(s.fifoAvailable).toBe(0);
  });

  it('reports no shortage once the opening batch exists', async () => {
    // Post-backfill: both layers agree at 40,000.
    const { service } = makeService({ stock: 40000, fifo: 40000 });
    expect(await service.detectShortages('t1', sheet(500))).toEqual([]);
  });
});

describe('detectShortages — availability is the minimum of both layers', () => {
  it('still catches a plain StockLevel shortage', async () => {
    const { service } = makeService({ stock: 100, fifo: 5000 });
    const [s] = await service.detectShortages('t1', sheet(500));

    expect(s.availableQuantity).toBe(100);
    expect(s.shortageQuantity).toBe(400);
    expect(s.limitedBy).toBe('STOCK_LEVEL');
  });

  it('uses the FIFO figure when it is the smaller of the two', async () => {
    const { service } = makeService({ stock: 5000, fifo: 120 });
    const [s] = await service.detectShortages('t1', sheet(500));

    expect(s.availableQuantity).toBe(120);
    expect(s.shortageQuantity).toBe(380);
    expect(s.limitedBy).toBe('FIFO_BATCHES');
  });

  it('passes when both layers cover the requirement', async () => {
    const { service } = makeService({ stock: 900, fifo: 800 });
    expect(await service.detectShortages('t1', sheet(500))).toEqual([]);
  });

  it('treats an exactly-sufficient balance as no shortage', async () => {
    const { service } = makeService({ stock: 500, fifo: 500 });
    expect(await service.detectShortages('t1', sheet(500))).toEqual([]);
  });

  it('queries both layers — not StockLevel alone', async () => {
    const { service, prisma } = makeService({ stock: 40000, fifo: 0 });
    await service.detectShortages('t1', sheet(500));

    expect(prisma.stockLevel.aggregate).toHaveBeenCalled();
    expect(prisma.purchaseBatch.aggregate).toHaveBeenCalled();
    const call = prisma.purchaseBatch.aggregate.mock.calls[0][0];
    expect(call.where).toMatchObject({ tenantId: 't1', itemId: 'raw-milk' });
    expect(call._sum).toEqual({ remaining: true });
  });

  it('aggregates repeated rows for one item before comparing', async () => {
    const { service } = makeService({ stock: 400, fifo: 400 });
    const dp = {
      id: 'dp1',
      cartonUsage: [],
      aluminumUsage: [],
      milkUsage: [
        { itemId: 'raw-milk', itemName: 'حليب خام', quantity: 300 },
        { itemId: 'raw-milk', itemName: 'حليب خام', quantity: 300 },
      ],
      wastages: [],
    };
    const [s] = await service.detectShortages('t1', dp);

    expect(s.requiredQuantity).toBe(600);
    expect(s.shortageQuantity).toBe(200);
  });
});

describe('posting modes now engage for FIFO-only shortages', () => {
  const sheetFor = () => ({
    ...sheet(500),
    tenantId: 't1',
    status: 'DRAFT',
    produced: [],
  });

  it('STRICT_MODE blocks a FIFO-only shortage', async () => {
    const { service } = makeService({ stock: 40000, fifo: 0, mode: 'STRICT_MODE' });
    service.get = jest.fn(async () => sheetFor());

    await expect(service.post('t1', 'u1', 'dp1')).rejects.toThrow();
  });

  it('WARNING_MODE asks for confirmation instead of failing silently', async () => {
    const { service } = makeService({ stock: 40000, fifo: 0, mode: 'WARNING_MODE' });
    service.get = jest.fn(async () => sheetFor());

    const res = await service.post('t1', 'u1', 'dp1');

    expect(res.success).toBe(false);
    expect(res.requiresConfirmation).toBe(true);
    expect(res.mode).toBe('WARNING_MODE');
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0].limitedBy).toBe('FIFO_BATCHES');
  });
});
