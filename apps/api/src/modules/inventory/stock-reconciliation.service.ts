import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

/**
 * StockReconciliationService — READ-ONLY stock model audit.
 * ────────────────────────────────────────────────────────
 * لماذا
 * ─────
 * يوجد في النظام طبقتان تصفان نفس المخزون:
 *
 *   StockLevel      الرصيد المعروض على الشاشات
 *   PurchaseBatch   طبقة التكلفة — وهي ما يستهلكه الإنتاج والبيع فعلياً
 *
 * عندما تتباعد الطبقتان تظهر أعطال يصعب تفسيرها: رصيد كافٍ على الشاشة
 * لكن الترحيل يفشل، أو تكلفة مبيعات صفرية، أو أرصدة سالبة. حدث ذلك فعلاً
 * في الإنتاج (حليب خام: StockLevel = 40,000 و FIFO remaining = 0).
 *
 * هذه الخدمة تكشف التباعد قبل أن يتحوّل إلى عطل.
 *
 * SAFETY CONTRACT
 * ───────────────
 * Every query here is a read. This service performs NO writes, opens no
 * transaction, and never repairs anything it finds — deliberately.
 * Reconciling a mismatch is a business decision (which layer is right?)
 * that needs a human, and an automatic "fix" would silently rewrite
 * inventory. Findings are reported with enough detail to act on
 * manually; ops/RECONCILE-stock-model.sql runs the same checks straight
 * against the database when the API is not reachable.
 */

export type ReconciliationSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

export interface ReconciliationFinding {
  check: string;
  severity: ReconciliationSeverity;
  itemId: string;
  sku: string | null;
  itemName: string;
  unit: string | null;
  active: boolean;
  stockLevel: number;
  fifoRemaining: number;
  difference: number;
  detail: string;
}

@Injectable()
export class StockReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  private static round(n: number, d = 4) {
    const f = Math.pow(10, d);
    return Math.round(n * f) / f;
  }

  /** Tolerance for decimal noise. Below this the layers count as equal. */
  private static readonly EPS = 0.001;

  async reconcile(
    tenantId: string,
    opts: { includeInactive?: boolean } = {},
  ): Promise<{
    generatedAt: string;
    tenantId: string;
    scope: { includeInactive: boolean; itemsExamined: number };
    summary: Record<string, number>;
    totals: {
      stockLevelSum: number;
      fifoRemainingSum: number;
      fifoInventoryValue: number;
      absoluteDrift: number;
    };
    findings: ReconciliationFinding[];
  }> {
    const R = StockReconciliationService.round;
    const EPS = StockReconciliationService.EPS;

    const items = await this.prisma.item.findMany({
      where: { tenantId, ...(opts.includeInactive ? {} : { active: true }) },
      select: { id: true, sku: true, name: true, unit: true, active: true },
      orderBy: { name: 'asc' },
    });

    const [stockRows, batchRows] = await Promise.all([
      this.prisma.stockLevel.groupBy({
        by: ['itemId'],
        where: { tenantId },
        _sum: { quantity: true },
        _count: { _all: true },
      }),
      this.prisma.purchaseBatch.groupBy({
        by: ['itemId'],
        where: { tenantId },
        _sum: { remaining: true, quantity: true },
        _count: { _all: true },
      }),
    ]);

    const stockBy = new Map(
      stockRows.map((r) => [r.itemId, { sum: Number(r._sum.quantity ?? 0), rows: r._count._all }]),
    );
    const batchBy = new Map(
      batchRows.map((r) => [
        r.itemId,
        { remaining: Number(r._sum.remaining ?? 0), rows: r._count._all },
      ]),
    );

    // Negative rows and duplicate opening batches need row-level detail,
    // so they are fetched separately rather than derived from the groups.
    const [negativeRows, openingBatches, valueRows] = await Promise.all([
      this.prisma.stockLevel.findMany({
        where: { tenantId, quantity: { lt: 0 } },
        select: { itemId: true, warehouseId: true, quantity: true },
      }),
      this.prisma.purchaseBatch.groupBy({
        by: ['itemId'],
        where: { tenantId, sourceType: 'OPENING_BALANCE' },
        _count: { _all: true },
      }),
      this.prisma.purchaseBatch.findMany({
        where: { tenantId },
        select: { itemId: true, remaining: true, unitCost: true, sourceType: true },
      }),
    ]);

    const negativeBy = new Map<string, number>();
    for (const r of negativeRows) {
      negativeBy.set(r.itemId, (negativeBy.get(r.itemId) ?? 0) + Number(r.quantity));
    }
    const openingCount = new Map(openingBatches.map((r) => [r.itemId, r._count._all]));

    // Items whose open batches all carry unitCost = 0 have a cost layer
    // that exists but is worthless — COGS will book as zero.
    const zeroCostOpen = new Map<string, { open: number; zero: number }>();
    for (const b of valueRows) {
      if (Number(b.remaining) <= EPS) continue;
      const cur = zeroCostOpen.get(b.itemId) ?? { open: 0, zero: 0 };
      cur.open += 1;
      if (Number(b.unitCost) <= 0) cur.zero += 1;
      zeroCostOpen.set(b.itemId, cur);
    }

    const findings: ReconciliationFinding[] = [];
    const push = (
      item: (typeof items)[number],
      check: string,
      severity: ReconciliationSeverity,
      stockLevel: number,
      fifoRemaining: number,
      detail: string,
    ) =>
      findings.push({
        check,
        severity,
        itemId: item.id,
        sku: item.sku ?? null,
        itemName: item.name,
        unit: item.unit ?? null,
        active: item.active,
        stockLevel: R(stockLevel),
        fifoRemaining: R(fifoRemaining),
        difference: R(stockLevel - fifoRemaining),
        detail,
      });

    let stockLevelSum = 0;
    let fifoRemainingSum = 0;
    let absoluteDrift = 0;

    for (const item of items) {
      const stock = stockBy.get(item.id)?.sum ?? 0;
      const fifo = batchBy.get(item.id)?.remaining ?? 0;
      const batches = batchBy.get(item.id)?.rows ?? 0;

      stockLevelSum += stock;
      fifoRemainingSum += fifo;
      absoluteDrift += Math.abs(stock - fifo);

      // 1. Balance with no cost layer behind it — production will refuse
      //    to post even though the screen looks healthy.
      if (stock > EPS && fifo <= EPS) {
        push(
          item, 'STOCK_WITHOUT_BATCHES', 'CRITICAL', stock, fifo,
          `رصيد ${R(stock)} بلا أي دفعة FIFO — الترحيل والبيع سيفشلان لهذا الصنف`,
        );
      }
      // 2. Batches with no balance — FIFO can consume stock the balance
      //    says is gone, so a sale can succeed against nothing.
      else if (fifo > EPS && stock <= EPS) {
        push(
          item, 'BATCHES_WITHOUT_STOCK', 'CRITICAL', stock, fifo,
          `دفعات مفتوحة بمقدار ${R(fifo)} بينما الرصيد صفر — استهلاك محتمل لمخزون غير موجود`,
        );
      }
      // 3. Both present but disagreeing.
      else if (Math.abs(stock - fifo) > EPS) {
        const diff = stock - fifo;
        push(
          item, 'LAYER_DRIFT', 'WARNING', stock, fifo,
          diff > 0
            ? `الرصيد يزيد ${R(diff)} عن تغطية الدفعات — هذا الفرق غير قابل للاستهلاك`
            : `الدفعات تزيد ${R(-diff)} عن الرصيد — تغطية تكلفة بلا رصيد مقابل`,
        );
      }

      // 4. Negative balances.
      const neg = negativeBy.get(item.id);
      if (neg !== undefined) {
        push(
          item, 'NEGATIVE_STOCK', 'CRITICAL', stock, fifo,
          `رصيد سالب بمقدار ${R(neg)} في مستودع واحد أو أكثر`,
        );
      }

      // 5. Duplicate opening coverage — an opening balance should be
      //    planted once; a second one double-counts the same stock.
      const opens = openingCount.get(item.id) ?? 0;
      if (opens > 1) {
        push(
          item, 'DUPLICATE_OPENING_BATCH', 'CRITICAL', stock, fifo,
          `${opens} دفعات افتتاحية لنفس الصنف — تغطية مكرّرة تضخّم المتاح`,
        );
      }

      // 6. Cost layer exists but is worthless.
      const zc = zeroCostOpen.get(item.id);
      if (zc && zc.open > 0 && zc.zero === zc.open) {
        push(
          item, 'ZERO_COST_LAYER', 'WARNING', stock, fifo,
          `كل الدفعات المفتوحة (${zc.open}) بتكلفة صفر — تكلفة المبيعات ستُسجَّل صفراً`,
        );
      } else if (zc && zc.zero > 0) {
        push(
          item, 'PARTIAL_ZERO_COST', 'INFO', stock, fifo,
          `${zc.zero} من ${zc.open} دفعة مفتوحة بتكلفة صفر`,
        );
      }

      // 7. Stock recorded with no batch rows at all, quantity zero —
      //    harmless today, but the item cannot be produced or sold.
      if (stock <= EPS && fifo <= EPS && batches === 0 && item.active) {
        push(item, 'NO_COVERAGE_IDLE', 'INFO', stock, fifo, 'لا رصيد ولا دفعات');
      }
    }

    const fifoInventoryValue = valueRows.reduce(
      (s, b) => s + Number(b.remaining) * Number(b.unitCost),
      0,
    );

    const summary: Record<string, number> = {};
    for (const f of findings) summary[f.check] = (summary[f.check] ?? 0) + 1;
    for (const s of ['CRITICAL', 'WARNING', 'INFO'] as const) {
      summary[s] = findings.filter((f) => f.severity === s).length;
    }

    const severityRank = { CRITICAL: 0, WARNING: 1, INFO: 2 };
    findings.sort(
      (a, b) =>
        severityRank[a.severity] - severityRank[b.severity] ||
        Math.abs(b.difference) - Math.abs(a.difference),
    );

    return {
      generatedAt: new Date().toISOString(),
      tenantId,
      scope: {
        includeInactive: !!opts.includeInactive,
        itemsExamined: items.length,
      },
      summary,
      totals: {
        stockLevelSum: R(stockLevelSum),
        fifoRemainingSum: R(fifoRemainingSum),
        fifoInventoryValue: R(fifoInventoryValue, 2),
        absoluteDrift: R(absoluteDrift),
      },
      findings,
    };
  }
}
