/**
 * Regression tests for `DailyProductionService.getTodayProductionSummary()`
 * — the SINGLE SOURCE OF TRUTH the Dashboard uses.
 *
 * The method delegates to `getDailySummary()` — the SAME code path used
 * by /production/summary — so by construction the numbers on the
 * Dashboard match what the user sees on the Daily Summary page.
 * These tests lock that contract in place.
 *
 * A previous revision re-implemented the aggregation with its own
 * timezone window, which could exclude records that /production/summary
 * would include. The refactor to delegate closes that hole.
 */

import { DailyProductionService } from './daily-production.service';

/** Minimal Prisma stub — covers only the fields the service reads. */
function makePrismaMock(rows: any[]) {
  return {
    dailyProduction: {
      findMany: jest.fn(async ({ where }: any) => {
        const gte = (where?.productionDate?.gte as Date) || new Date(0);
        const lt = (where?.productionDate?.lt as Date) || new Date(8e15);
        return rows.filter((r) => {
          const t = new Date(r.productionDate).getTime();
          return t >= gte.getTime() && t < lt.getTime();
        });
      }),
    },
  };
}
function makeSvc(prisma: any) {
  return new (DailyProductionService as any)(prisma) as DailyProductionService;
}

const originalTZ = process.env.TZ_OFFSET_MIN;
beforeAll(() => { process.env.TZ_OFFSET_MIN = '180'; });
afterAll(() => { process.env.TZ_OFFSET_MIN = originalTZ; });

// Server-local (UTC on Render) noon on the test date.
const NOW = new Date('2026-07-20T12:00:00Z');

// Helper — the Daily Summary code parses YYYY-MM-DD as UTC midnight
// then calls setHours(0,0,0,0). On a UTC test runner that yields
// exactly `YYYY-MM-DDT00:00:00Z` as the window start.
const utcMidnight = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

// Baseline shape all rows need.
const emptyExtras = {
  cartonUsage: [],
  aluminumUsage: [],
  milkUsage: [],
  wastages: [],
};

describe('DailyProductionService.getTodayProductionSummary — Dashboard SoT', () => {
  const tenantId = 't1';

  it('mirrors /production/summary for today (400 + 200 = 600)', async () => {
    // The exact live scenario from 2026-07-20: two Draft records with
    // real produced quantities that /production/summary shows as 600.
    const today = utcMidnight('2026-07-20');
    const rows = [
      {
        id: 'day-17', tenantId, productionDate: today, status: 'DRAFT',
        ...emptyExtras,
        produced: [{ itemName: 'Product 1', cartonsTotal: 200, palletsCount: 0 }],
      },
      {
        id: 'day-16', tenantId, productionDate: today, status: 'DRAFT',
        ...emptyExtras,
        produced: [{ itemName: 'Product 2', cartonsTotal: 400, palletsCount: 0 }],
      },
    ];
    const svc = makeSvc(makePrismaMock(rows));
    const r = await svc.getTodayProductionSummary(tenantId, NOW);
    expect(r.totalProduction).toBe(600);
    expect(r.totalOutput).toBe(600);
    expect(r.productionDayCount).toBe(2);
    expect(r.productionDate).toBe('2026-07-20');
  });

  it('DRAFT records count on the Dashboard exactly as they do on the summary page', async () => {
    // The business rule: if the quantity is entered, it counts.
    // Nothing about Draft vs Posted status should affect the total.
    const today = utcMidnight('2026-07-20');
    const rows = [
      { id: 'a', tenantId, productionDate: today, status: 'DRAFT',
        ...emptyExtras, produced: [{ itemName: 'x', cartonsTotal: 100, palletsCount: 0 }] },
      { id: 'b', tenantId, productionDate: today, status: 'POSTED',
        ...emptyExtras, produced: [{ itemName: 'y', cartonsTotal: 500, palletsCount: 0 }] },
    ];
    const svc = makeSvc(makePrismaMock(rows));
    const r = await svc.getTodayProductionSummary(tenantId, NOW);
    expect(r.totalProduction).toBe(600);
  });

  it('excludes records dated yesterday', async () => {
    const yesterday = utcMidnight('2026-07-19');
    const rows = [
      { id: 'r-y', tenantId, productionDate: yesterday, status: 'POSTED',
        ...emptyExtras, produced: [{ itemName: 'z', cartonsTotal: 9999, palletsCount: 0 }] },
    ];
    const svc = makeSvc(makePrismaMock(rows));
    const r = await svc.getTodayProductionSummary(tenantId, NOW);
    expect(r.totalProduction).toBe(0);
    expect(r.productionDayCount).toBe(0);
  });

  it('near midnight in Jordan — a record for today Jordan counts even when UTC is still yesterday', async () => {
    // Real edge case: Jordan 01:00 on July 20 = July 19 22:00 UTC.
    // The Dashboard hits the API from the browser. If the API server
    // is UTC and just uses server-local midnight it would still be
    // "yesterday" in its own eyes. Our TZ_OFFSET_MIN shift picks
    // Jordan's calendar date, then getDailySummary buckets by
    // server-midnight of that date — which on UTC Render = the same
    // UTC-midnight rows are stored at.
    const nearMidnightJordan = new Date('2026-07-19T22:00:00Z');
    const rows = [
      { id: 'r-near', tenantId, productionDate: utcMidnight('2026-07-20'), status: 'DRAFT',
        ...emptyExtras, produced: [{ itemName: 'x', cartonsTotal: 42, palletsCount: 0 }] },
      { id: 'r-yest', tenantId, productionDate: utcMidnight('2026-07-19'), status: 'DRAFT',
        ...emptyExtras, produced: [{ itemName: 'x', cartonsTotal: 9999, palletsCount: 0 }] },
    ];
    const svc = makeSvc(makePrismaMock(rows));
    const r = await svc.getTodayProductionSummary(tenantId, nearMidnightJordan);
    expect(r.productionDate).toBe('2026-07-20');
    expect(r.totalProduction).toBe(42);
  });

  it('coerces string quantities and defends against null/undefined', async () => {
    const today = utcMidnight('2026-07-20');
    const rows = [
      {
        id: 'r-mixed', tenantId, productionDate: today, status: 'DRAFT',
        ...emptyExtras,
        produced: [
          { itemName: 'x', cartonsTotal: '100', palletsCount: 0 },
          { itemName: 'x', cartonsTotal: null as any, palletsCount: 0 },
          { itemName: 'x', cartonsTotal: undefined as any, palletsCount: 0 },
          { itemName: 'x', cartonsTotal: 50, palletsCount: 0 },
        ],
      },
    ];
    const svc = makeSvc(makePrismaMock(rows));
    const r = await svc.getTodayProductionSummary(tenantId, NOW);
    expect(r.totalProduction).toBe(150);
  });

  it('empty database returns zeros — never NaN, never undefined', async () => {
    const svc = makeSvc(makePrismaMock([]));
    const r = await svc.getTodayProductionSummary(tenantId, NOW);
    expect(r.totalProduction).toBe(0);
    expect(r.totalWaste).toBe(0);
    expect(r.wastePercentage).toBe(0);
    expect(r.wastePct).toBe(0);
    expect(r.totalOutput).toBe(0);
    expect(r.productionDayCount).toBe(0);
  });

  it('wastePct is a FRACTION (0.05) so Dashboard × 100 shows the right %', async () => {
    // Dashboard renders: `((p.wastePct ?? 0) * 100).toFixed(1)`
    // getDailySummary returns wasteRate as a percent (5 for 5%).
    // We must divide by 100 so the multiplication in the Dashboard
    // yields the correct value back.
    const today = utcMidnight('2026-07-20');
    const rows = [
      {
        id: 'w', tenantId, productionDate: today, status: 'DRAFT',
        cartonUsage: [], aluminumUsage: [],
        milkUsage: [{ count: 4, quantity: 0 }],   // 4 bags × 25kg = 100 kg raw
        wastages: [{ quantity: 5 }],              // 5 kg waste
        produced: [{ itemName: 'x', cartonsTotal: 100, palletsCount: 0 }],
      },
    ];
    const svc = makeSvc(makePrismaMock(rows));
    const r = await svc.getTodayProductionSummary(tenantId, NOW);
    // 5 / 100 = 5% → summary wasteRate = 5 → dashboard wastePct = 0.05
    expect(r.wastePct).toBeCloseTo(0.05, 4);
  });

  it('is IDENTICAL to what /production/summary returns for the same date', async () => {
    // The "same code path" invariant. If /production/summary shows 600,
    // the Dashboard shows 600. Full stop.
    const today = utcMidnight('2026-07-20');
    const rows = [
      { id: 'a', tenantId, productionDate: today, status: 'DRAFT',
        ...emptyExtras, produced: [{ itemName: 'p1', cartonsTotal: 400, palletsCount: 0 }] },
      { id: 'b', tenantId, productionDate: today, status: 'DRAFT',
        ...emptyExtras, produced: [{ itemName: 'p2', cartonsTotal: 200, palletsCount: 0 }] },
    ];
    const svc = makeSvc(makePrismaMock(rows));

    const dashboard = await svc.getTodayProductionSummary(tenantId, NOW);
    const summary = await svc.getDailySummary(tenantId, { date: '2026-07-20' });

    expect(dashboard.totalOutput).toBe(summary.totals.cartons);
    expect(dashboard.productionDayCount).toBe(summary.recordsCount);
  });
});
