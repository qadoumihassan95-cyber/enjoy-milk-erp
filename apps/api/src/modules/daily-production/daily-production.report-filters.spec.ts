/**
 * Regression tests for the report status filters.
 *
 * Root cause being pinned: dailyReport, getDailySummary and
 * customers.getCustomerStats queried without any status filter, so a
 * CANCELLED record — whose stock movements and FIFO batches were fully
 * reversed by cancel() — still contributed to the totals.
 *
 * These tests assert on the Prisma `where` clause actually issued, which
 * is what the defect was: a missing predicate, not a bad calculation.
 */

import { DailyProductionService } from './daily-production.service';
import { CustomersService } from '../customers/customers.service';

describe('report status filters — daily production', () => {
  let captured: any[];
  let service: any;

  const record = (status: string, cartons: number) => ({
    id: `dp-${status}-${cartons}`,
    status,
    shift: 'صباحي',
    notes: null,
    productionDate: new Date('2026-08-17'),
    createdAt: new Date('2026-08-17'),
    produced: [{ itemName: 'حليب جاهز 750 غم', cartonsTotal: cartons }],
    wastages: [{ itemName: 'حليب جاهز 750 غم', quantity: 5 }],
    milkUsage: [{ quantity: 100, count: 0 }],
    aluminumUsage: [{ quantity: 2 }],
    cartonUsage: [{ quantity: 3 }],
    machines: [],
  });

  // Only DRAFT and POSTED are returned — the mock honours the filter the
  // service sends, so a missing filter would surface the CANCELLED row.
  const ALL = [record('DRAFT', 10), record('POSTED', 20), record('CANCELLED', 999)];

  beforeEach(() => {
    captured = [];
    const prisma: any = {
      dailyProduction: {
        findMany: jest.fn(async (args: any) => {
          captured.push(args);
          const not = args?.where?.status?.not;
          return not ? ALL.filter((r) => r.status !== not) : ALL;
        }),
      },
    };
    service = new DailyProductionService(prisma, {} as any, {} as any, {} as any);
  });

  describe('dailyReport', () => {
    it('excludes CANCELLED in the query', async () => {
      await service.dailyReport('t1', new Date('2026-08-17'));
      expect(captured[0].where.status).toEqual({ not: 'CANCELLED' });
    });

    it('keeps the tenant and date predicates intact', async () => {
      await service.dailyReport('t1', new Date('2026-08-17'));
      expect(captured[0].where.tenantId).toBe('t1');
      expect(captured[0].where.productionDate).toHaveProperty('gte');
      expect(captured[0].where.productionDate).toHaveProperty('lt');
    });

    it('does not let a cancelled sheet inflate the totals', async () => {
      const res = await service.dailyReport('t1', new Date('2026-08-17'));
      // 10 + 20, not 10 + 20 + 999
      expect(res.summary.totalCartons).toBe(30);
      expect(res.recordsCount).toBe(2);
    });

    it('still counts DRAFT — this is an operational screen', async () => {
      const res = await service.dailyReport('t1', new Date('2026-08-17'));
      expect(res.counts).toEqual({ draft: 1, posted: 1 });
    });
  });

  describe('getDailySummary', () => {
    it('excludes CANCELLED in the query', async () => {
      await service.getDailySummary('t1', {});
      expect(captured[0].where.status).toEqual({ not: 'CANCELLED' });
    });

    it('does not let a cancelled sheet inflate cartons or waste', async () => {
      const res = await service.getDailySummary('t1', {});
      expect(res.totals.cartons).toBe(30);
      expect(res.totals.waste).toBe(10); // 5 + 5, not 15
      expect(res.recordsCount).toBe(2);
    });

    it('reports the draft/posted split', async () => {
      const res = await service.getDailySummary('t1', {});
      expect(res.counts).toEqual({ draft: 1, posted: 1 });
    });

    it('preserves the itemName filter option', async () => {
      const res = await service.getDailySummary('t1', { itemName: 'لا يوجد' });
      expect(res.filter.itemName).toBe('لا يوجد');
    });
  });
});

describe('report status filters — customer receivables', () => {
  it('excludes CANCELLED orders from outstanding balance', async () => {
    const captured: any[] = [];
    const prisma: any = {
      customer: {
        findMany: jest.fn(async () => [{ id: 'c1', name: 'زبون', active: true }]),
      },
      salesOrder: {
        aggregate: jest.fn(async (args: any) => {
          captured.push(args);
          return { _sum: { total: 500, paid: 200 } };
        }),
      },
    };
    const service: any = new CustomersService(prisma, {} as any);

    const res = await service.getCustomerStats('t1');

    expect(captured[0].where.status).toEqual({ not: 'CANCELLED' });
    expect(captured[0].where.tenantId).toBe('t1');
    expect(captured[0].where.customerId).toBe('c1');
    expect(res[0].outstanding).toBe(300);
  });
});
