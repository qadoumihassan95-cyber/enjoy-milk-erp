/**
 * Regression tests for the single source of truth
 * `DailyProductionService.getTodayProductionSummary()`.
 *
 * These tests exist because the Dashboard "الإنتاج اليوم" card was
 * previously wired to a legacy `RepackService.getDailySummary()` that
 * read an empty table, producing 0 while the /production page showed
 * real records. Any refactor that forks the calculation MUST update
 * these tests.
 */

import { DailyProductionService } from './daily-production.service';

/** Minimal Prisma stub that only implements dailyProduction.findMany. */
function makePrismaMock(rows: any[]) {
  return {
    dailyProduction: {
      findMany: jest.fn(async ({ where }: any) => {
        const gte = where?.productionDate?.gte as Date;
        const lt = where?.productionDate?.lt as Date;
        return rows.filter((r) => {
          const d = new Date(r.productionDate).getTime();
          return d >= gte.getTime() && d < lt.getTime();
        });
      }),
    },
  };
}
function makeSvc(prisma: any) {
  return new (DailyProductionService as any)(prisma) as DailyProductionService;
}

// Jordan is UTC+3. Fix the offset explicitly so the tests are deterministic
// no matter what timezone CI runs in.
const originalTZ = process.env.TZ_OFFSET_MIN;
beforeAll(() => { process.env.TZ_OFFSET_MIN = '180'; });
afterAll(() => { process.env.TZ_OFFSET_MIN = originalTZ; });

// Jordan noon on the test date, expressed as UTC (12:00 local = 09:00 UTC)
const NOW = new Date('2026-07-19T09:00:00Z');
// Start of that Jordan day expressed as UTC (00:00 local = 21:00 UTC previous day)
const jordanStartUTC = (localYYYYMMDD: string) => {
  const [y, m, d] = localYYYYMMDD.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - 180 * 60_000);
};

describe('DailyProductionService.getTodayProductionSummary', () => {
  const tenantId = 't1';

  it('sums produced.cartonsTotal for records dated today (local)', async () => {
    const today = jordanStartUTC('2026-07-19');
    const rows = [
      {
        id: 'r1', tenantId, productionDate: today,
        produced: [{ cartonsTotal: 200 }, { cartonsTotal: 152_400 }],
        wastages: [{ quantity: 5 }],
      },
      {
        id: 'r2', tenantId, productionDate: today,
        produced: [{ cartonsTotal: 1152 }],
        wastages: [],
      },
    ];
    const svc = makeSvc(makePrismaMock(rows));
    const r = await svc.getTodayProductionSummary(tenantId, NOW);
    expect(r.totalProduction).toBe(200 + 152_400 + 1152); // = 153,752
    expect(r.totalOutput).toBe(r.totalProduction);        // legacy alias
    expect(r.productionDayCount).toBe(2);
    expect(r.machineRunCount).toBe(2);
    expect(r.totalWaste).toBe(5);
    expect(r.wastePercentage).toBeCloseTo(5 / (153_752 + 5), 8);
    expect(r.productionDate).toBe('2026-07-19');
  });

  it('excludes records dated yesterday (local)', async () => {
    const yesterday = jordanStartUTC('2026-07-18');
    const rows = [
      { id: 'r-y', tenantId, productionDate: yesterday, produced: [{ cartonsTotal: 9999 }], wastages: [] },
    ];
    const svc = makeSvc(makePrismaMock(rows));
    const r = await svc.getTodayProductionSummary(tenantId, NOW);
    expect(r.totalProduction).toBe(0);
    expect(r.productionDayCount).toBe(0);
  });

  it('near midnight — a record saved at 00:30 local counts as TODAY', async () => {
    // Jordan 00:30 on 2026-07-19  = 2026-07-18T21:30:00Z
    const nearMidnightUTC = new Date('2026-07-18T21:30:00Z');
    // The record's productionDate is normalised to 2026-07-19 local start:
    const todayLocalStartUTC = jordanStartUTC('2026-07-19');
    const rows = [
      { id: 'r-near', tenantId, productionDate: todayLocalStartUTC, produced: [{ cartonsTotal: 42 }], wastages: [] },
    ];
    const svc = makeSvc(makePrismaMock(rows));
    const r = await svc.getTodayProductionSummary(tenantId, nearMidnightUTC);
    expect(r.totalProduction).toBe(42);
    expect(r.productionDate).toBe('2026-07-19');
  });

  it('coerces string quantities and defends against null/undefined', async () => {
    const today = jordanStartUTC('2026-07-19');
    const rows = [
      {
        id: 'r-mixed', tenantId, productionDate: today,
        produced: [
          { cartonsTotal: '100' },        // string
          { cartonsTotal: null as any },  // null → 0
          { cartonsTotal: undefined as any }, // undefined → 0
          { cartonsTotal: 50 },
        ],
        wastages: [{ quantity: null as any }, { quantity: '3' }],
      },
    ];
    const svc = makeSvc(makePrismaMock(rows));
    const r = await svc.getTodayProductionSummary(tenantId, NOW);
    expect(r.totalProduction).toBe(150);
    expect(r.totalWaste).toBe(3);
  });

  it('DRAFT and POSTED records both count', async () => {
    // status is irrelevant to the aggregator — the mock doesn't filter on it,
    // matching the real Prisma call which has no `where: { status: ... }`.
    const today = jordanStartUTC('2026-07-19');
    const rows = [
      { id: 'r-draft', tenantId, productionDate: today, status: 'DRAFT',  produced: [{ cartonsTotal: 200 }], wastages: [] },
      { id: 'r-post',  tenantId, productionDate: today, status: 'POSTED', produced: [{ cartonsTotal: 300 }], wastages: [] },
    ];
    const svc = makeSvc(makePrismaMock(rows));
    const r = await svc.getTodayProductionSummary(tenantId, NOW);
    expect(r.totalProduction).toBe(500);
    expect(r.productionDayCount).toBe(2);
  });

  it('empty database returns zeros, not NaN', async () => {
    const svc = makeSvc(makePrismaMock([]));
    const r = await svc.getTodayProductionSummary(tenantId, NOW);
    expect(r.totalProduction).toBe(0);
    expect(r.totalWaste).toBe(0);
    expect(r.wastePercentage).toBe(0);
    expect(r.productionDayCount).toBe(0);
  });
});
