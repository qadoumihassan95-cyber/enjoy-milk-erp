import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { normaliseUnit } from './unit-conversion';

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
    diagnostics: {
      conversionMismatch: any[];
      legacyFactorItems: any[];
      ledgerMismatch: any[];
      wasteCostMissing: any[];
    };
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

    // ═══════════════════════════════════════════════════════════════
    //  Stage 4.4 diagnostics — row-level checks, still strictly read-only
    // ═══════════════════════════════════════════════════════════════
    const diagnostics = await this.collectDiagnostics(tenantId);

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
      diagnostics,
    };
  }

  /**
   * Row-level checks that do not fit the per-item findings shape.
   *
   * Same contract as the rest of this service: every query is a read, and
   * nothing here repairs anything. These surface the specific defects
   * Stage 4 fixed going forward, so the historical rows they left behind
   * stay visible until someone decides what to do with them.
   */
  private async collectDiagnostics(tenantId: string) {
    const R = StockReconciliationService.round;

    const [milk, carton, aluminum, waste, items, movements, levels, wasteSheets] =
      await Promise.all([
        (this.prisma as any).productionMilkUsage.findMany({ where: { tenantId } }),
        (this.prisma as any).productionCartonUsage.findMany({ where: { tenantId } }),
        (this.prisma as any).productionAluminumUsage.findMany({ where: { tenantId } }),
        (this.prisma as any).productionWaste.findMany({ where: { tenantId } }),
        this.prisma.item.findMany({
          where: { tenantId },
          select: { id: true, sku: true, name: true, unit: true, bagWeightKg: true },
        }),
        this.prisma.stockMovement.findMany({
          where: { tenantId },
          select: { itemId: true, type: true, quantity: true },
        }),
        this.prisma.stockLevel.groupBy({
          by: ['itemId'], where: { tenantId }, _sum: { quantity: true },
        }),
        (this.prisma as any).productionCostAllocation.findMany({
          where: { tenantId },
          select: { dailyProductionId: true, method: true },
        }),
      ]);

    const itemById = new Map(items.map((i: any) => [i.id, i]));

    // ── 1. Conversion mismatch ──────────────────────────────────────
    // A usage row whose unit disagrees with its item's, or that the
    // converter could not reconcile at all. Live example: a waste row of
    // 300 "L" against a PCS item.
    const conversionMismatch: any[] = [];
    const scan = (rows: any[], source: string) => {
      for (const r of rows) {
        if (!r.itemId) continue;
        const item: any = itemById.get(r.itemId);
        if (!item) continue;
        const rowUnit = normaliseUnit(r.unit ?? item.unit);
        const itemUnit = normaliseUnit(item.unit);
        if (r.factorSource === 'UNCONVERTIBLE' || (r.unit && rowUnit !== itemUnit)) {
          conversionMismatch.push({
            source, rowId: r.id, itemId: r.itemId,
            sku: item.sku, itemName: item.name,
            rowUnit, itemUnit,
            quantity: R(Number(r.quantity ?? 0)),
            factorSource: r.factorSource ?? null,
            detail: `وحدة السطر (${rowUnit}) تخالف وحدة الصنف (${itemUnit})`,
          });
        }
      }
    };
    scan(milk, 'milkUsage');
    scan(carton, 'cartonUsage');
    scan(aluminum, 'aluminumUsage');
    scan(waste, 'wastage');

    // ── 2. Items still relying on the legacy 25 kg fallback ─────────
    const legacyItemIds = new Set(
      milk.filter((m: any) => m.factorSource === 'LEGACY_DEFAULT' && m.itemId)
          .map((m: any) => m.itemId),
    );
    const legacyFactorItems = [...legacyItemIds].map((id) => {
      const i: any = itemById.get(id as string);
      return {
        itemId: id, sku: i?.sku ?? null, itemName: i?.name ?? '',
        bagWeightKg: i?.bagWeightKg ? Number(i.bagWeightKg) : null,
        rows: milk.filter((m: any) => m.itemId === id && m.factorSource === 'LEGACY_DEFAULT').length,
        detail: 'عرّف «وزن الكيس» على الصنف ليتوقف استخدام الافتراضي القديم',
      };
    });

    // ── 3. Movement ledger mismatch ─────────────────────────────────
    // StockLevel vs the net of the item's own movements. A large gap means
    // the balance was written outside the application — this is the check
    // that surfaced the ×100 anomaly.
    const netByItem = new Map<string, number>();
    for (const m of movements as any[]) {
      const q = Number(m.quantity ?? 0);
      const signed = m.type === 'IN' || m.type === 'RETURN' ? q : -q;
      netByItem.set(m.itemId, (netByItem.get(m.itemId) ?? 0) + signed);
    }
    const ledgerMismatch: any[] = [];
    for (const l of levels as any[]) {
      const stock = Number(l._sum.quantity ?? 0);
      const net = netByItem.get(l.itemId) ?? 0;
      if (Math.abs(stock - net) > StockReconciliationService.EPS) {
        const i: any = itemById.get(l.itemId);
        ledgerMismatch.push({
          itemId: l.itemId, sku: i?.sku ?? null, itemName: i?.name ?? '',
          stockLevel: R(stock), netFromMovements: R(net),
          unexplained: R(stock - net),
          detail: 'الرصيد لا يساوي صافي حركاته — كُتب على الأرجح خارج التطبيق',
        });
      }
    }
    ledgerMismatch.sort((a, b) => Math.abs(b.unexplained) - Math.abs(a.unexplained));

    // ── 4. Waste with no measured cost ──────────────────────────────
    // A posted sheet that recorded waste but has no waste allocation was
    // posted before waste consumed FIFO. Its waste cost in the report is
    // the old carton-cost estimate, not a measurement.
    const sheetsWithWasteAlloc = new Set(
      (wasteSheets as any[])
        .filter((a) => (a.method ?? '').startsWith('FIFO_WASTE'))
        .map((a) => a.dailyProductionId),
    );
    const wasteBySheet = new Map<string, number>();
    for (const w of waste as any[]) {
      wasteBySheet.set(
        w.dailyProductionId,
        (wasteBySheet.get(w.dailyProductionId) ?? 0) + Number(w.quantity ?? 0),
      );
    }
    const wasteCostMissing = [...wasteBySheet.entries()]
      .filter(([id, qty]) => qty > 0 && !sheetsWithWasteAlloc.has(id))
      .map(([dailyProductionId, qty]) => ({
        dailyProductionId,
        wasteQuantity: R(qty),
        detail: 'توالف بلا تكلفة مقاسة — رُحِّلت قبل أن تستهلك التوالف دفعات FIFO',
      }));

    return { conversionMismatch, legacyFactorItems, ledgerMismatch, wasteCostMissing };
  }
}
