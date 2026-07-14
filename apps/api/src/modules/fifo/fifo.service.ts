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

  /** COGS + إجمالي المبيعات + الربح، ضمن نطاق تاريخ اختياري */
  async getCogsProfit(
    tenantId: string,
    range?: { from?: Date | string; to?: Date | string },
  ) {
    const where: Prisma.SaleCostAllocationWhereInput = { tenantId };
    if (range?.from || range?.to) {
      where.createdAt = {};
      if (range.from) (where.createdAt as any).gte = new Date(range.from);
      if (range.to) (where.createdAt as any).lte = new Date(range.to);
    }
    const cogsRows = await this.prisma.saleCostAllocation.findMany({
      where,
      select: { saleOrderId: true, totalCost: true, quantity: true },
    });
    const cogs = cogsRows.reduce((s, r) => s + Number(r.totalCost), 0);

    // إجمالي المبيعات لنفس النطاق
    const salesWhere: Prisma.SimpleOrderWhereInput = { tenantId };
    if (range?.from || range?.to) {
      salesWhere.orderDate = {};
      if (range.from) (salesWhere.orderDate as any).gte = new Date(range.from);
      if (range.to) (salesWhere.orderDate as any).lte = new Date(range.to);
    }
    const salesAgg = await this.prisma.simpleOrder.aggregate({
      where: salesWhere,
      _sum: { total: true },
    });
    const revenue = Number(salesAgg._sum.total ?? 0);
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
