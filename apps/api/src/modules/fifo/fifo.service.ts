import {
  Injectable,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
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
  // (0) أمان التزامن — قفل صفوف الدفعات
  // ═══════════════════════════════════════════════════════════
  /**
   * Concurrency model — why this exists
   * ───────────────────────────────────
   * The previous implementation read candidate batches with a plain
   * `findMany`, computed `avail - take` in JavaScript, then wrote that
   * absolute value back. Under PostgreSQL's default READ COMMITTED
   * isolation two concurrent transactions both read `remaining = 100`,
   * both computed `100 - 60 = 40`, and both wrote 40. 120 units were
   * consumed from a batch that held 100, silently, with no error — a
   * textbook lost update. COGS is wrong from that moment on and nothing
   * surfaces it.
   *
   * Two independent defences are now in place.
   *
   * 1. `SELECT … FOR UPDATE` (this method).
   *    Takes a row-level exclusive lock on every candidate batch for the
   *    remainder of the transaction. A second transaction touching the
   *    same batches blocks at this statement until the first commits or
   *    rolls back, and then re-reads the *new* `remaining`. Serialised,
   *    so FIFO order and availability are both computed against reality.
   *
   *    `SKIP LOCKED` is deliberately NOT used: skipping a locked batch
   *    would break FIFO ordering and could report a false shortage.
   *    Blocking is the correct behaviour here.
   *
   * 2. A guarded conditional decrement at the write site:
   *      updateMany({ where: { id, remaining: { gte: take } },
   *                   data:  { remaining: { decrement: take } } })
   *    This compiles to `SET remaining = remaining - take WHERE
   *    remaining >= take` — evaluated by the database against the current
   *    row, never against a value computed in application memory. Even if
   *    a future caller invokes this service outside a transaction and the
   *    lock is therefore not held to commit, the decrement still cannot
   *    drive `remaining` negative; it matches zero rows instead, and we
   *    raise rather than silently over-consume.
   *
   * Deadlock avoidance — deterministic lock ordering
   * ────────────────────────────────────────────────
   * Within one item, every caller locks rows in the same total order:
   * `purchaseDate, createdAt, id`. `id` is included so the ordering is
   * total even when two batches share a timestamp — without it two
   * transactions could acquire the same pair of rows in opposite orders.
   *
   * Across items, the caller is responsible for consuming items in a
   * deterministic order. `daily-production.service.post()` sorts its raw
   * rows by `itemId` before consuming for exactly this reason: two sheets
   * listing the same materials in different order would otherwise be able
   * to deadlock.
   *
   * Residual deadlocks (unavoidable in principle) are handled by
   * `runWithRetry` below.
   */
  private async lockBatchesForUpdate(
    client: Prisma.TransactionClient,
    tenantId: string,
    itemId: string,
  ): Promise<void> {
    // Only the ids are selected: the lock is the point, and reading the
    // numeric columns back through Prisma's typed client below avoids
    // raw-driver Decimal conversion differences.
    await client.$queryRaw`
      SELECT id
      FROM "PurchaseBatch"
      WHERE "tenantId" = ${tenantId}
        AND "itemId"   = ${itemId}
        AND remaining  > 0
      ORDER BY "purchaseDate" ASC, "createdAt" ASC, id ASC
      FOR UPDATE
    `;
  }

  /**
   * Read the FIFO-ordered candidate batches for an item, holding an
   * exclusive lock on each for the rest of the transaction.
   */
  private async lockAndLoadBatches(
    client: Prisma.TransactionClient,
    tenantId: string,
    itemId: string,
  ) {
    await this.lockBatchesForUpdate(client, tenantId, itemId);
    return client.purchaseBatch.findMany({
      where: { tenantId, itemId, remaining: { gt: 0 } },
      orderBy: [{ purchaseDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * Atomically take `qty` from one batch.
   *
   * Returns false when the row no longer satisfies `remaining >= qty`,
   * which under a correctly held lock should be unreachable — it is the
   * backstop described in defence (2) above.
   */
  private async takeFromBatch(
    client: Prisma.TransactionClient,
    batchId: string,
    qty: number,
  ): Promise<boolean> {
    const res = await client.purchaseBatch.updateMany({
      where: { id: batchId, remaining: { gte: new Prisma.Decimal(qty) } },
      data: { remaining: { decrement: new Prisma.Decimal(qty) } },
    });
    return res.count === 1;
  }

  /**
   * Retry wrapper for the transactions this service opens itself.
   *
   * PostgreSQL aborts one participant of a deadlock (40P01) and can abort
   * a transaction on serialization failure (40001). Both are transient and
   * safe to replay: nothing was committed. Callers that pass their own
   * `tx` are NOT retried here — retrying half of someone else's
   * transaction would be incorrect, so their outer handler owns it.
   */
  private async runWithRetry<T>(
    fn: (client: Prisma.TransactionClient) => Promise<T>,
    attempts = 3,
  ): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await this.prisma.$transaction((c) => fn(c));
      } catch (err: any) {
        const code = err?.code ?? err?.meta?.code;
        const transient =
          code === '40P01' || code === '40001' || code === 'P2034';
        if (!transient || i === attempts - 1) throw err;
        lastErr = err;
        // Small linear backoff — enough to let the winner commit.
        await new Promise((r) => setTimeout(r, 25 * (i + 1)));
      }
    }
    throw lastErr;
  }

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
      // قفل صفوف الدفعات فعلياً (SELECT … FOR UPDATE) قبل القراءة —
      // راجع lockBatchesForUpdate لشرح سبب ذلك.
      const batches = await this.lockAndLoadBatches(
        client,
        tenantId,
        dto.itemId,
      );

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

        // خصم ذرّي مشروط — تقيّمه قاعدة البيانات على الصف الحالي
        const ok = await this.takeFromBatch(client, b.id, take);
        if (!ok) {
          throw new ConflictException(
            'تعذّر خصم الدفعة بسبب تعديل متزامن — أعد المحاولة',
          );
        }

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

    // عند فتح المعاملة داخلياً نعيد المحاولة على الأخطاء العابرة
    // (deadlock / serialization). أما إذا مرّر المتصل tx فالمسؤولية عليه.
    return tx ? exec(tx) : this.runWithRetry(exec);
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
      // زيادة ذرّية بدل قراءة-ثم-كتابة: الاسترجاع كان يعاني من نفس سباق
      // الفقدان (lost update) الموجود في الاستهلاك — عمليتا إلغاء متزامنتان
      // على دفعة واحدة كانتا تكتبان القيمة نفسها فتضيع إحدى الاستعادتين.
      for (const a of allocs) {
        await client.purchaseBatch.updateMany({
          where: { id: a.batchId, tenantId },
          data: { remaining: { increment: new Prisma.Decimal(Number(a.quantity)) } },
        });
      }
      await client.saleCostAllocation.deleteMany({
        where: { tenantId, saleOrderId },
      });
      return { restoredAllocations: allocs.length };
    };
    // عند فتح المعاملة داخلياً نعيد المحاولة على الأخطاء العابرة
    // (deadlock / serialization). أما إذا مرّر المتصل tx فالمسؤولية عليه.
    return tx ? exec(tx) : this.runWithRetry(exec);
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
      // نفس استراتيجية القفل المستخدمة في البيع — راجع lockBatchesForUpdate
      const batches = await this.lockAndLoadBatches(
        client,
        tenantId,
        dto.rawItemId,
      );

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

        const ok = await this.takeFromBatch(client, b.id, take);
        if (!ok) {
          throw new ConflictException(
            'تعذّر خصم الدفعة بسبب تعديل متزامن — أعد المحاولة',
          );
        }

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

    // عند فتح المعاملة داخلياً نعيد المحاولة على الأخطاء العابرة
    // (deadlock / serialization). أما إذا مرّر المتصل tx فالمسؤولية عليه.
    return tx ? exec(tx) : this.runWithRetry(exec);
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

        // زيادة ذرّية — انظر التعليق في reverseForSale
        await client.purchaseBatch.updateMany({
          where: { id: b.id, tenantId },
          data: { remaining: { increment: new Prisma.Decimal(Number(a.quantity)) } },
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
    // عند فتح المعاملة داخلياً نعيد المحاولة على الأخطاء العابرة
    // (deadlock / serialization). أما إذا مرّر المتصل tx فالمسؤولية عليه.
    return tx ? exec(tx) : this.runWithRetry(exec);
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
