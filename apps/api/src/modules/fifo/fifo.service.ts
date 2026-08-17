import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';

/**
 * FifoCostingService
 * ─────────────────
 * الخدمة المسؤولة عن:
 *   1) تسجيل دفعات الشراء (Purchase Batches) عند كل استلام مادة.
 *   2) استهلاك الدفعات عند البيع بأسلوب FIFO (الأقدم أولاً)
 *      وحفظ توزيع التكلفة بشكل دائم في SaleCostAllocation.
 *   3) استعادة الرصيد عند حذف/إرجاع البيع.
 *   4) توفير تقارير: قيمة المخزون FIFO، COGS، الربح، حركة الدفعات.
 *
 * ثابتة الأرباح: مادامت التوزيعات محفوظة، أي تغيير في أسعار الشراء المستقبلية
 * لا يؤثر على COGS/الربح للعمليات السابقة.
 */
@Injectable()
export class FifoCostingService {
  constructor(private readonly prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════
  // (1) إنشاء دفعة شراء
  // ═══════════════════════════════════════════════════════════
  async createPurchaseBatch(
    tenantId: string,
    userId: string | null,
    dto: {
      itemId: string;
      quantity: number | string;
      unitCost: number | string;
      currency?: string;
      batchNumber?: string;
      purchaseDate?: Date | string;
      sourceType?: string;
      sourceRefId?: string;
      supplierId?: string;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const q = Number(dto.quantity);
    if (!(q > 0)) throw new BadRequestException('كمية الدفعة يجب أن تكون أكبر من صفر');
    const uc = Number(dto.unitCost);
    if (!(uc >= 0)) throw new BadRequestException('سعر الوحدة غير صحيح');

    const client = tx ?? this.prisma;
    return client.purchaseBatch.create({
      data: {
        tenantId,
        itemId: dto.itemId,
        quantity: new Prisma.Decimal(q),
        remaining: new Prisma.Decimal(q),
        unitCost: new Prisma.Decimal(uc),
        currency: dto.currency ?? 'JOD',
        batchNumber: dto.batchNumber ?? null,
        purchaseDate: dto.purchaseDate ? new Date(dto.purchaseDate) : new Date(),
        sourceType: dto.sourceType ?? 'MANUAL',
        sourceRefId: dto.sourceRefId ?? null,
        supplierId: dto.supplierId ?? null,
        createdById: userId,
      },
    });
  }

  // ═══════════════════════════════════════════════════════════
  // (2) استهلاك دفعات لعملية بيع (Transactional)
  // ═══════════════════════════════════════════════════════════
  /**
   * يستهلك FIFO الكمية المطلوبة من أقدم الدفعات، ينشئ سجلات
   * SaleCostAllocation، ويُعيد الإجمالي (totalCost) وقائمة السجلات.
   *
   * يُنفَّذ داخل transaction للحماية من السباقات (race conditions).
   */
  async consumeForSale(
    tenantId: string,
    dto: {
      saleOrderId: string;
      saleLineId?: string;
      itemId: string;
      quantity: number | string;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const need = Number(dto.quantity);
    if (!(need > 0)) throw new BadRequestException('الكمية المباعة غير صحيحة');

    // إذا لم يُقدَّم tx، ننشئ واحداً محلياً
    const exec = async (client: Prisma.TransactionClient) => {
      // Lock السطور — نقرأ الدفعات المتاحة مرتّبة FIFO
      const batches = await client.purchaseBatch.findMany({
        where: {
          tenantId,
          itemId: dto.itemId,
          remaining: { gt: 0 },
        },
        orderBy: [{ purchaseDate: 'asc' }, { createdAt: 'asc' }],
      });

      const totalAvailable = batches.reduce((s, b) => s + Number(b.remaining), 0);
      if (totalAvailable + 1e-9 < need) {
        throw new BadRequestException(
          `الكمية المتاحة (${totalAvailable}) أقل من المطلوبة (${need})`,
        );
      }

      let remainingNeed = need;
      let totalCost = 0;
      const allocations: any[] = [];

      for (const b of batches) {
        if (remainingNeed <= 0) break;
        const avail = Number(b.remaining);
        const take = Math.min(avail, remainingNeed);
        if (take <= 0) continue;

        const lineCost = take * Number(b.unitCost);
        totalCost += lineCost;
        remainingNeed -= take;

        // خصم الرصيد المتبقي من الدفعة
        await client.purchaseBatch.update({
          where: { id: b.id },
          data: { remaining: new Prisma.Decimal(avail - take) },
        });

        // إنشاء سجل التوزيع الدائم
        const alloc = await client.saleCostAllocation.create({
          data: {
            tenantId,
            saleOrderId: dto.saleOrderId,
            saleLineId: dto.saleLineId ?? null,
            itemId: dto.itemId,
            batchId: b.id,
            quantity: new Prisma.Decimal(take),
            unitCost: new Prisma.Decimal(Number(b.unitCost)),
            totalCost: new Prisma.Decimal(lineCost),
            method: 'FIFO',
          },
        });
        allocations.push(alloc);
      }

      return {
        totalCost,
        allocations,
        quantityConsumed: need - remainingNeed,
      };
    };

    return tx ? exec(tx) : this.prisma.$transaction((c) => exec(c));
  }

  // ═══════════════════════════════════════════════════════════
  // (3) عكس عملية بيع — استعادة الرصيد للدفعات + حذف التوزيعات
  // ═══════════════════════════════════════════════════════════
  async reverseForSale(
    tenantId: string,
    saleOrderId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const exec = async (client: Prisma.TransactionClient) => {
      const allocs = await client.saleCostAllocation.findMany({
        where: { tenantId, saleOrderId },
      });
      for (const a of allocs) {
        const b = await client.purchaseBatch.findUnique({ where: { id: a.batchId } });
        if (!b) continue;
        await client.purchaseBatch.update({
          where: { id: b.id },
          data: {
            remaining: new Prisma.Decimal(
              Number(b.remaining) + Number(a.quantity),
            ),
          },
        });
      }
      await client.saleCostAllocation.deleteMany({
        where: { tenantId, saleOrderId },
      });
      return { restoredAllocations: allocs.length };
    };
    return tx ? exec(tx) : this.prisma.$transaction((c) => exec(c));
  }

  // ═══════════════════════════════════════════════════════════
  // (2b) استهلاك دفعات لعملية إنتاج (مواد خام)
  // ═══════════════════════════════════════════════════════════
  /**
   * Production-side twin of `consumeForSale`. Consumes raw-material
   * PurchaseBatch rows FIFO, decrements `remaining`, and writes a
   * `ProductionCostAllocation` per batch touched. Returns the total
   * cost consumed so the caller can price produced batches.
   *
   * ⚠️  Contract:
   *   • Called from within an outer $transaction — callers MUST pass
   *     `tx`. The method is idempotent per (dailyProductionId, rawItemId)
   *     because DailyProduction.post() runs exactly once per record
   *     (re-post is blocked with a status guard).
   *   • Throws if PurchaseBatch stock is insufficient, UNLESS
   *     `allowShortage` is set. The outer transaction rolls back
   *     cleanly — the ledger stays consistent.
   *
   * SHORTAGE COSTING (`allowShortage: true`)
   * ----------------------------------------
   * A factory consumes material it physically has even when the ledger
   * has not caught up. When the batches cannot cover the requirement we
   * consume every real batch first (true FIFO order, real unit costs),
   * then open ONE synthetic batch for the uncovered remainder:
   *
   *     sourceType = 'SHORTAGE', quantity = shortfall, remaining = 0
   *     unitCost   = item.avgCost ?? item.costPrice ?? 0
   *
   * `remaining: 0` means it can never be consumed again, so it adds no
   * phantom availability. It exists so the shortfall carries a cost and
   * a ProductionCostAllocation row: COGS stays complete instead of
   * silently understating by the missing quantity, and every deficit is
   * queryable by `sourceType='SHORTAGE'` for later correction.
   *
   * `quantityConsumed` reports the REAL quantity drawn from real
   * batches; `shortageQuantity` reports what had to be synthesised.
   */
  async consumeForProduction(
    tenantId: string,
    dto: {
      dailyProductionId: string;
      rawItemId: string;
      quantity: number | string;
      allowShortage?: boolean;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<{
    totalCost: number;
    allocations: any[];
    quantityConsumed: number;
    shortageQuantity: number;
  }> {
    const need = Number(dto.quantity);
    if (!(need > 0)) {
      return { totalCost: 0, allocations: [], quantityConsumed: 0, shortageQuantity: 0 };
    }

    const exec = async (client: Prisma.TransactionClient) => {
      const batches = await client.purchaseBatch.findMany({
        where: {
          tenantId,
          itemId: dto.rawItemId,
          remaining: { gt: 0 },
        },
        orderBy: [{ purchaseDate: 'asc' }, { createdAt: 'asc' }],
      });

      const totalAvailable = batches.reduce((s, b) => s + Number(b.remaining), 0);

      // Without allowShortage this remains exactly the strict FIFO gate
      // it has always been.
      if (totalAvailable + 1e-9 < need && !dto.allowShortage) {
        throw new BadRequestException(
          `دفعات المادة الخام غير كافية (المتاح: ${totalAvailable}، المطلوب: ${need})`,
        );
      }

      let remainingNeed = need;
      let totalCost = 0;
      const allocations: any[] = [];

      for (const b of batches) {
        if (remainingNeed <= 0) break;
        const avail = Number(b.remaining);
        const take = Math.min(avail, remainingNeed);
        if (take <= 0) continue;
        const lineCost = take * Number(b.unitCost);
        totalCost += lineCost;
        remainingNeed -= take;

        await client.purchaseBatch.update({
          where: { id: b.id },
          data: { remaining: new Prisma.Decimal(avail - take) },
        });

        const alloc = await (client as any).productionCostAllocation.create({
          data: {
            tenantId,
            dailyProductionId: dto.dailyProductionId,
            rawItemId: dto.rawItemId,
            batchId: b.id,
            quantity: new Prisma.Decimal(take),
            unitCost: new Prisma.Decimal(Number(b.unitCost)),
            totalCost: new Prisma.Decimal(lineCost),
            method: 'FIFO',
          },
        });
        allocations.push(alloc);
      }

      // Whatever the real batches could not cover.
      const shortageQuantity = remainingNeed > 1e-9 ? remainingNeed : 0;

      if (shortageQuantity > 0) {
        const item = await client.item.findUnique({ where: { id: dto.rawItemId } });
        const unitCost = Number(item?.avgCost ?? item?.costPrice ?? 0);

        // remaining: 0 — documents the deficit and carries its cost, but
        // can never be consumed, so it adds no phantom availability.
        const shortageBatch = await client.purchaseBatch.create({
          data: {
            tenantId,
            itemId: dto.rawItemId,
            batchNumber: null,
            purchaseDate: new Date(),
            quantity: new Prisma.Decimal(shortageQuantity),
            remaining: new Prisma.Decimal(0),
            unitCost: new Prisma.Decimal(unitCost),
            sourceType: 'SHORTAGE',
            sourceRefId: dto.dailyProductionId,
          },
        });

        const lineCost = shortageQuantity * unitCost;
        totalCost += lineCost;

        const alloc = await (client as any).productionCostAllocation.create({
          data: {
            tenantId,
            dailyProductionId: dto.dailyProductionId,
            rawItemId: dto.rawItemId,
            batchId: shortageBatch.id,
            quantity: new Prisma.Decimal(shortageQuantity),
            unitCost: new Prisma.Decimal(unitCost),
            totalCost: new Prisma.Decimal(lineCost),
            method: 'FIFO_SHORTAGE',
          },
        });
        allocations.push(alloc);
      }

      return {
        totalCost,
        allocations,
        quantityConsumed: need - remainingNeed,
        shortageQuantity,
      };
    };

    return tx ? exec(tx) : this.prisma.$transaction((c) => exec(c));
  }

  // ═══════════════════════════════════════════════════════════
  // (3b) عكس عملية إنتاج — استعادة الدفعات + حذف التوزيعات
  // ═══════════════════════════════════════════════════════════
  async reverseForProduction(
    tenantId: string,
    dailyProductionId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const exec = async (client: Prisma.TransactionClient) => {
      const allocs = await (client as any).productionCostAllocation.findMany({
        where: { tenantId, dailyProductionId },
      });
      const shortageBatchIds: string[] = [];

      for (const a of allocs) {
        const b = await client.purchaseBatch.findUnique({ where: { id: a.batchId } });
        if (!b) continue;

        // A SHORTAGE batch represents material that never existed. Adding
        // its quantity back would manufacture phantom stock out of a
        // cancelled posting, so it is removed rather than restored.
        if (b.sourceType === 'SHORTAGE') {
          shortageBatchIds.push(b.id);
          continue;
        }

        await client.purchaseBatch.update({
          where: { id: b.id },
          data: {
            remaining: new Prisma.Decimal(Number(b.remaining) + Number(a.quantity)),
          },
        });
      }

      // Allocations first — they hold the FK to the batch.
      await (client as any).productionCostAllocation.deleteMany({
        where: { tenantId, dailyProductionId },
      });

      if (shortageBatchIds.length) {
        await client.purchaseBatch.deleteMany({
          where: { id: { in: shortageBatchIds }, sourceType: 'SHORTAGE' },
        });
      }

      return {
        restoredAllocations: allocs.length,
        removedShortageBatches: shortageBatchIds.length,
      };
    };
    return tx ? exec(tx) : this.prisma.$transaction((c) => exec(c));
  }

  // ═══════════════════════════════════════════════════════════
  // (4) تقارير
  // ═══════════════════════════════════════════════════════════

  /** قيمة المخزون الحالية FIFO — Σ (remaining × unitCost) */
  async getInventoryValue(tenantId: string) {
    const rows = await this.prisma.purchaseBatch.findMany({
      where: { tenantId, remaining: { gt: 0 } },
      select: { itemId: true, remaining: true, unitCost: true },
    });
    const byItem: Record<string, { qty: number; value: number }> = {};
    let totalValue = 0;
    for (const r of rows) {
      const qty = Number(r.remaining);
      const v = qty * Number(r.unitCost);
      totalValue += v;
      if (!byItem[r.itemId]) byItem[r.itemId] = { qty: 0, value: 0 };
      byItem[r.itemId].qty += qty;
      byItem[r.itemId].value += v;
    }
    return { totalValue: round(totalValue, 4), byItem };
  }

  /**
   * COGS + إجمالي المبيعات + الربح، ضمن نطاق تاريخ اختياري.
   *
   * PERIOD ANCHORING: revenue and COGS are both anchored on
   * `SimpleOrder.orderDate` so back-dated orders land in the same
   * period on both sides. Previously revenue used `orderDate` while
   * COGS used `SaleCostAllocation.createdAt`, which scattered the two
   * legs across periods whenever an order was created on a date other
   * than its orderDate (any back-dated order).
   *
   * CANCELLED FILTER: revenue explicitly excludes CANCELLED orders,
   * matching the FE assumption that "gross profit" is on realised sales.
   * Without this filter, cancelled orders inflated revenue while their
   * matching COGS had been reversed via reverseForSale — phantom profit.
   */
  async getCogsProfit(
    tenantId: string,
    range?: { from?: Date | string; to?: Date | string },
  ) {
    // Build the shared orderDate window ONCE — revenue and COGS use it identically.
    const orderDateWindow: any = {};
    if (range?.from) orderDateWindow.gte = new Date(range.from);
    if (range?.to) orderDateWindow.lte = new Date(range.to);
    const hasWindow = !!(range?.from || range?.to);

    // Two-step to avoid needing a schema-level SaleCostAllocation→SimpleOrder
    // relation. Step 1: enumerate the qualifying orders for the period.
    // Step 2: sum allocations whose saleOrderId ∈ that set.
    // Same set of orders drives both revenue and COGS — no scatter.
    const qualifyingOrders = await this.prisma.simpleOrder.findMany({
      where: {
        tenantId,
        status: { not: 'CANCELLED' },
        ...(hasWindow && { orderDate: orderDateWindow }),
      },
      select: { id: true, total: true },
    });
    const orderIds = qualifyingOrders.map((o) => o.id);
    const revenue = qualifyingOrders.reduce((s, o) => s + Number(o.total), 0);

    const cogsRows = orderIds.length
      ? await this.prisma.saleCostAllocation.findMany({
          where: { tenantId, saleOrderId: { in: orderIds } },
          select: { saleOrderId: true, totalCost: true, quantity: true },
        })
      : [];
    const cogs = cogsRows.reduce((s, r) => s + Number(r.totalCost), 0);
    return {
      revenue: round(revenue, 4),
      cogs: round(cogs, 4),
      grossProfit: round(revenue - cogs, 4),
      grossMargin: revenue > 0 ? round(((revenue - cogs) / revenue) * 100, 2) : 0,
    };
  }

  /** حركة دفعات (اختياري: تصفية على itemId) */
  async listBatches(
    tenantId: string,
    opts: { itemId?: string; onlyOpen?: boolean } = {},
  ) {
    const where: Prisma.PurchaseBatchWhereInput = { tenantId };
    if (opts.itemId) where.itemId = opts.itemId;
    if (opts.onlyOpen) where.remaining = { gt: 0 };
    return this.prisma.purchaseBatch.findMany({
      where,
      orderBy: [{ purchaseDate: 'desc' }, { createdAt: 'desc' }],
      include: { allocations: true },
    });
  }

  /** تفاصيل توزيع تكلفة بيع محدد (لصفحة التفاصيل) */
  async getSaleAllocations(tenantId: string, saleOrderId: string) {
    const allocs = await this.prisma.saleCostAllocation.findMany({
      where: { tenantId, saleOrderId },
      include: { batch: true },
      orderBy: { createdAt: 'asc' },
    });
    const totalCost = allocs.reduce((s, a) => s + Number(a.totalCost), 0);
    const totalQty = allocs.reduce((s, a) => s + Number(a.quantity), 0);
    return { allocations: allocs, totalCost, totalQty, method: 'FIFO' };
  }
}

function round(n: number, d = 2) {
  const p = Math.pow(10, d);
  return Math.round(n * p) / p;
}
