import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  resolveConversion,
  normaliseUnit,
  type FactorSource,
} from '../inventory/unit-conversion';
import { FifoCostingService } from '../fifo/fifo.service';

/**
 * Daily Production Service — ورقة الإنتاج اليومية
 *
 * الأقسام:
 *   1) المواد المسحوبة من المستودع الخام:
 *      - الكرتون (cartonUsage)
 *      - الألمنيوم (aluminumUsage)
 *      - الحليب (milkUsage)
 *   2) المواد المنتجة (produced)
 *   3) التوالف (wastages)
 *   4) الملاحظات (notes)
 *
 * عند POST:
 *   - خصم المواد الخام من المخزون
 *   - إضافة المنتجات إلى المخزون
 *   - خصم التوالف من المخزون
 *   - رصيد المستودع يُحسب من جدول StockLevel تلقائياً
 */
@Injectable()
export class DailyProductionService {
  // ═══════════════════════════════════════════════════════════════════
  // وحدات القياس — التحويل يحدث هنا، لا في المتصفح
  // ═══════════════════════════════════════════════════════════════════
  /**
   * Load the items referenced by a set of usage rows, keyed by id.
   * One query instead of one per row.
   */
  private async loadItems(tx: any, tenantId: string, rows: any[]) {
    const ids = Array.from(
      new Set(rows.flatMap((r) => (r?.itemId ? [r.itemId] : []))),
    );
    if (!ids.length) return new Map<string, any>();
    const items = await tx.item.findMany({
      where: { tenantId, id: { in: ids } },
      select: {
        id: true, unit: true, bagWeightKg: true,
        packsPerCarton: true, gramsPerUnit: true,
      },
    });
    return new Map<string, any>(items.map((i: any) => [i.id, i]));
  }

  /**
   * Express `qty` (given in `fromUnit`) in the item's own unit, and report
   * how it was derived so the caller can persist the snapshot.
   *
   * An unsupported pair does NOT throw. A waste row of 300 "L" against a
   * PCS item exists in live data, and refusing to post a sheet because a
   * historical unit label is nonsense would block real work. The quantity
   * passes through unchanged and is tagged UNCONVERTIBLE so the
   * reconciliation report lists it for correction. Silence would be the
   * bug; a labelled passthrough is not.
   */
  private convertToItemUnit(
    item: any | undefined,
    qty: number,
    fromUnit: string | null | undefined,
  ): { quantity: number; unitFactor: number | null; factorSource: FactorSource; unit: string } {
    const itemUnit = normaliseUnit(item?.unit);
    if (!item) {
      return { quantity: qty, unitFactor: null, factorSource: 'MANUAL', unit: normaliseUnit(fromUnit) };
    }
    const from = normaliseUnit(fromUnit ?? item.unit);
    try {
      const r = resolveConversion(item, qty, from);
      return {
        quantity: r.quantity,
        unitFactor: r.factor,
        factorSource: r.factorSource,
        unit: itemUnit,
      };
    } catch {
      return { quantity: qty, unitFactor: null, factorSource: 'UNCONVERTIBLE', unit: itemUnit };
    }
  }

  /**
   * Milk is entered as a bag COUNT. The browser used to multiply by a
   * hardcoded 25 and send the result; the server now owns that conversion
   * so the factor can be recorded and per-item weights honoured.
   *
   * When `count` is 0 the operator typed the weight directly — taken as
   * given and tagged MANUAL rather than reverse-engineered.
   */
  private resolveMilkRow(item: any | undefined, row: any) {
    const count = Number(row.count ?? 0);
    if (count > 0 && item) {
      const c = this.convertToItemUnit(item, count, 'BAG');
      return { ...c, count };
    }
    return {
      quantity: Number(row.quantity ?? 0),
      unitFactor: null,
      factorSource: 'MANUAL' as FactorSource,
      unit: normaliseUnit(item?.unit ?? row.unit),
      count,
    };
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly fifo: FifoCostingService,
  ) {}

  // ─── List ─────────────────────────────────────────
  async list(tenantId: string, opts: { from?: string; to?: string } = {}) {
    const where: any = { tenantId };
    if (opts.from) where.productionDate = { gte: new Date(opts.from) };
    if (opts.to) where.productionDate = { ...where.productionDate, lte: new Date(opts.to) };

    return this.prisma.dailyProduction.findMany({
      where,
      include: {
        cartonUsage: true,
        aluminumUsage: true,
        milkUsage: true,
        produced: true,
        wastages: true,
      },
      orderBy: { productionDate: 'desc' },
      take: 100,
    });
  }

  // ─── Get one ──────────────────────────────────────
  async get(tenantId: string, id: string) {
    const dp = await this.prisma.dailyProduction.findFirst({
      where: { id, tenantId },
      include: {
        cartonUsage: true,
        aluminumUsage: true,
        milkUsage: true,
        produced: true,
        wastages: true,
      },
    });
    if (!dp) throw new NotFoundException('سجل الإنتاج غير موجود');
    return dp;
  }

  // ─── Get with computed warehouse balance ──────────
  async getWithBalance(tenantId: string, id: string) {
    const dp = await this.get(tenantId, id);
    const balance = await this.computeWarehouseBalance(tenantId);
    return { ...dp, warehouseBalance: balance };
  }

  // ─── Create (header) ──────────────────────────────
  async create(tenantId: string, userId: string, data: any) {
    const date = new Date(data.productionDate ?? Date.now());
    date.setHours(0, 0, 0, 0);

    return this.prisma.dailyProduction.create({
      data: {
        tenantId,
        productionDate: date,
        shift: data.shift ?? null,
        operatorName: data.operatorName ?? null,
        operatorId: data.operatorId ?? null,
        machineNumber: data.machineNumber ?? null,
        notes: data.notes ?? null,
        status: 'DRAFT',
        createdById: userId,
      },
      include: {
        cartonUsage: true,
        aluminumUsage: true,
        milkUsage: true,
        produced: true,
        wastages: true,
      },
    });
  }

  // ─── Update header ────────────────────────────────
  async update(tenantId: string, id: string, data: any) {
    const dp = await this.get(tenantId, id);
    if (dp.status === 'POSTED') {
      throw new BadRequestException(
        'لا يمكن التعديل — السجل تم ترحيله للمخزون. ألغِه أولاً.',
      );
    }
    return this.prisma.dailyProduction.update({
      where: { id },
      data: {
        shift: data.shift,
        operatorName: data.operatorName,
        operatorId: data.operatorId,
        machineNumber: data.machineNumber,
        notes: data.notes,
      },
    });
  }

  // ─── Save full day (يستبدل كل البنود بالبيانات الجديدة) ──
  /**
   * يستلم كل الأقسام دفعة واحدة ويستبدل الموجود.
   * يُستخدم من شاشة "ورقة الإنتاج" عند الضغط على "حفظ".
   */
  async saveAll(
    tenantId: string,
    id: string,
    data: {
      shift?: string;
      operatorName?: string;
      machineNumber?: number;
      notes?: string;
      cartonUsage?: Array<{ itemId?: string; itemName: string; quantity: number; unit?: string; warehouseId?: string }>;
      aluminumUsage?: Array<{ itemId?: string; itemName: string; quantity: number; unit?: string; warehouseId?: string }>;
      milkUsage?: Array<{ itemId?: string; itemName?: string; count?: number; quantity: number; unit?: string; warehouseId?: string }>;
      produced?: Array<{ itemId?: string; itemName: string; cartonsTotal: number; warehouseId?: string; notes?: string }>;
      wastages?: Array<{ itemId?: string; itemName: string; quantity: number; unit?: string; warehouseId?: string; reason?: string }>;
    },
  ) {
    const dp = await this.get(tenantId, id);
    if (dp.status === 'POSTED') {
      throw new BadRequestException('لا يمكن التعديل — تم الترحيل');
    }

    return this.prisma.$transaction(async (tx) => {
      // حدّث الـ header
      await tx.dailyProduction.update({
        where: { id },
        data: {
          shift: data.shift ?? dp.shift,
          operatorName: data.operatorName ?? dp.operatorName,
          machineNumber: data.machineNumber ?? dp.machineNumber,
          notes: data.notes ?? dp.notes,
        },
      });

      // امسح القديم
      await tx.productionCartonUsage.deleteMany({ where: { dailyProductionId: id } });
      await tx.productionAluminumUsage.deleteMany({ where: { dailyProductionId: id } });
      await tx.productionMilkUsage.deleteMany({ where: { dailyProductionId: id } });
      await tx.productionProducedItem.deleteMany({ where: { dailyProductionId: id } });
      await tx.productionWaste.deleteMany({ where: { dailyProductionId: id } });

      // ─── تطبيع الوحدات قبل الحفظ ───────────────────────────────
      // التحويل صار هنا بدل المتصفح: الواجهة كانت تضرب عدد الأكياس × 25
      // ثابتة، والخادم يخزّن الناتج دون أن يعرف أن تحويلاً حدث. الآن
      // يُحسب التحويل من إعداد الصنف نفسه، وتُحفظ لقطة المعامل مع كل سطر
      // حتى تبقى الورقة قابلة لإعادة الإنتاج بعد أي تعديل على الصنف.
      const allRows = [
        ...(data.cartonUsage ?? []),
        ...(data.aluminumUsage ?? []),
        ...(data.milkUsage ?? []),
        ...(data.wastages ?? []),
      ];
      const itemsById = await this.loadItems(tx, tenantId, allRows);

      // الكرتون
      if (data.cartonUsage?.length) {
        await tx.productionCartonUsage.createMany({
          data: data.cartonUsage.map((r) => {
            const c = this.convertToItemUnit(
              itemsById.get(r.itemId ?? ''), Number(r.quantity ?? 0), r.unit,
            );
            return {
              tenantId,
              dailyProductionId: id,
              itemId: r.itemId ?? null,
              itemName: r.itemName,
              quantity: new Prisma.Decimal(c.quantity),
              unit: c.unit,
              unitFactor: c.unitFactor === null ? null : new Prisma.Decimal(c.unitFactor),
              factorSource: c.factorSource,
              warehouseId: r.warehouseId ?? null,
            };
          }),
        });
      }

      // الألمنيوم
      if (data.aluminumUsage?.length) {
        await tx.productionAluminumUsage.createMany({
          data: data.aluminumUsage.map((r) => {
            const c = this.convertToItemUnit(
              itemsById.get(r.itemId ?? ''), Number(r.quantity ?? 0), r.unit,
            );
            return {
              tenantId,
              dailyProductionId: id,
              itemId: r.itemId ?? null,
              itemName: r.itemName,
              quantity: new Prisma.Decimal(c.quantity),
              unit: c.unit,
              unitFactor: c.unitFactor === null ? null : new Prisma.Decimal(c.unitFactor),
              factorSource: c.factorSource,
              warehouseId: r.warehouseId ?? null,
            };
          }),
        });
      }

      // الحليب — يُدخَل بعدد الأكياس، والخادم يحوّله
      if (data.milkUsage?.length) {
        await tx.productionMilkUsage.createMany({
          data: data.milkUsage.map((r) => {
            const c = this.resolveMilkRow(itemsById.get(r.itemId ?? ''), r);
            return {
              tenantId,
              dailyProductionId: id,
              itemId: r.itemId ?? null,
              itemName: r.itemName ?? null,
              count: c.count,
              quantity: new Prisma.Decimal(c.quantity),
              unit: c.unit,
              unitFactor: c.unitFactor === null ? null : new Prisma.Decimal(c.unitFactor),
              factorSource: c.factorSource,
              warehouseId: r.warehouseId ?? null,
            };
          }),
        });
      }

      // المواد المنتجة (يدعم machineNumber لكل سطر إنتاج)
      if (data.produced?.length) {
        await tx.productionProducedItem.createMany({
          data: data.produced.map((p: any) => ({
            tenantId,
            dailyProductionId: id,
            itemId: p.itemId ?? null,
            itemName: p.itemName,
            cartonsTotal: p.cartonsTotal ?? 0,
            machineNumber:
              p.machineNumber === undefined || p.machineNumber === null || p.machineNumber === ''
                ? null
                : Number(p.machineNumber),
            warehouseId: p.warehouseId ?? null,
            notes: p.notes ?? null,
          })),
        });
      }

      // التوالف
      if (data.wastages?.length) {
        await tx.productionWaste.createMany({
          data: data.wastages.map((w) => {
            // نفس التطبيع المطبَّق على المواد الخام. سطر توالف بوحدة لا
            // تُحوَّل إلى وحدة الصنف (موجود فعلاً في البيانات: 300 "L"
            // على صنف PCS) يمرّ كما هو ويُوسَم UNCONVERTIBLE ليظهر في
            // تقرير المطابقة، بدل أن يمنع الترحيل أو يمرّ بصمت.
            const c = this.convertToItemUnit(
              itemsById.get(w.itemId ?? ''), Number(w.quantity ?? 0), w.unit,
            );
            return {
              tenantId,
              dailyProductionId: id,
              itemId: w.itemId ?? null,
              itemName: w.itemName,
              quantity: new Prisma.Decimal(c.quantity),
              unit: c.unit,
              unitFactor: c.unitFactor === null ? null : new Prisma.Decimal(c.unitFactor),
              factorSource: c.factorSource,
              warehouseId: w.warehouseId ?? null,
              reason: w.reason ?? null,
            };
          }),
        });
      }

      return tx.dailyProduction.findUnique({
        where: { id },
        include: {
          cartonUsage: true,
          aluminumUsage: true,
          milkUsage: true,
          produced: true,
          wastages: true,
        },
      });
    });
  }

  // ─── POST — تطبيق على المخزون ─────────────────────
  /**
   * SINGLE-WAREHOUSE MODEL
   * ---------------------
   * The factory operates from ONE warehouse (code=MAIN). Historical
   * data may still reference legacy warehouses (FIN/BULK/PKG/QHL) via
   * StockMovement.fromWarehouseId, but every new consumption/output
   * MUST land against MAIN so that:
   *   • Sum(StockLevel per item) == the number the user sees in
   *     /inventory (single source of truth).
   *   • A receipt in /inventory/receive (which also targets MAIN) is
   *     visible to production, and vice-versa.
   *   • No row ever silently drops because a legacy warehouse code
   *     didn't exist on a freshly-provisioned tenant.
   *
   * STRICT ITEM LINKAGE
   * -------------------
   * A row with quantity>0 but no itemId used to be silently skipped —
   * the sheet showed the number, the ledger didn't move, and stock
   * drift accumulated. We now throw. The FE must pick an item from
   * the ItemSelector; free-text-only rows are rejected at post time.
   */
  async post(
    tenantId: string,
    userId: string,
    id: string,
    opts: { allowShortage?: boolean; userRole?: string } = {},
  ): Promise<any> {
    const dp = await this.get(tenantId, id);
    if (dp.status === 'POSTED') {
      throw new BadRequestException('تم الترحيل مسبقاً');
    }
    if (dp.status === 'CANCELLED') {
      // Reject re-post of a cancelled sheet — otherwise a subsequent
      // cancel() will reverse BOTH the old and the new movements and
      // corrupt the ledger.
      throw new BadRequestException(
        'لا يمكن ترحيل ورقة ملغاة. أنشئ ورقة جديدة بدلاً منها.',
      );
    }

    const mode = await this.getPostingMode(tenantId);

    // ─── PRE-FLIGHT SHORTAGE CHECK (no writes) ──────────────────────
    // Every raw-material shortage is detected BEFORE the transaction
    // opens, so the UI can ask the operator what to do instead of
    // discovering the problem halfway through a rollback.
    const shortages = await this.detectShortages(tenantId, dp);

    if (shortages.length) {
      if (mode === 'STRICT_MODE') {
        // Unchanged behaviour — the posting is refused outright.
        const first = shortages[0];
        throw new BadRequestException(
          `المخزون لا يكفي للصنف "${first.item}" (المتاح: ${first.availableQuantity}، المطلوب: ${first.requiredQuantity})`,
        );
      }

      if (mode === 'OVERRIDE_MODE') {
        const privileged = ['OWNER', 'ADMIN', 'MANAGER'];
        if (!opts.userRole || !privileged.includes(String(opts.userRole).toUpperCase())) {
          throw new ForbiddenException(
            'وضع الترحيل الحالي (OVERRIDE) يسمح بالترحيل مع نقص المخزون للمدراء فقط.',
          );
        }
      }

      // WARNING_MODE / authorised OVERRIDE_MODE: do NOT write anything
      // until the operator has seen the shortage and confirmed. The
      // client re-sends with allowShortage=true.
      if (!opts.allowShortage) {
        return {
          success: false,
          requiresConfirmation: true,
          mode,
          warnings: shortages,
        };
      }
    }

    const allowShortage = shortages.length > 0 && !!opts.allowShortage;

    // Resolve the SINGLE operational warehouse. If MAIN doesn't exist
    // yet (fresh tenant), it is auto-created — matches the /inventory
    // receive/adjust behaviour and guarantees the two modules always
    // agree on where stock lives.
    const mainWh = await this.resolveMainWarehouse(tenantId);

    // Helper: uniform per-row validation. Anything with a positive
    // quantity MUST resolve to an item — otherwise the printed sheet
    // and the ledger would diverge.
    const requireItem = (
      row: { itemId?: string | null; itemName?: string | null; quantity?: any },
      section: string,
    ) => {
      const qty = Number(row.quantity ?? 0);
      if (qty > 0 && !row.itemId) {
        throw new BadRequestException(
          `${section}: "${row.itemName ?? '(بدون اسم)'}" — يجب اختيار الصنف من قائمة المخزون قبل الترحيل`,
        );
      }
    };

    return this.prisma.$transaction(async (tx) => {
      // ─── DB-LEVEL DOUBLE-POST GUARD (G4) ────────────────────────
      // Two concurrent /post requests can race between the read above and
      // the writes below. We atomically claim the sheet with an updateMany
      // whose WHERE pins the current status. Only ONE caller gets
      // count===1; a concurrent caller blocks on the row lock until this
      // transaction ends, then re-evaluates the WHERE and gets count===0.
      //
      // THIS MUST STAY INSIDE THE TRANSACTION (incident 2026-08-16).
      // It previously ran on this.prisma before $transaction opened, so it
      // committed on its own. Any later failure — an insufficient-stock
      // BadRequest, a FIFO shortage — rolled back the inventory work but
      // LEFT status='POSTING' committed. The sheet then became permanently
      // unpostable: every retry matched neither DRAFT nor POSTED and threw
      // "لا يمكن الترحيل — الحالة الحالية: POSTING". Exactly one live sheet
      // (cmsvrcm590014z0puc21wmt28) was stranded this way.
      const claim = await tx.dailyProduction.updateMany({
        where: { id, tenantId, status: 'DRAFT' },
        data: { status: 'POSTING' as any, postedAt: new Date(), postedById: userId },
      });
      if (claim.count !== 1) {
        const now = await tx.dailyProduction.findFirst({ where: { id, tenantId } });
        throw new BadRequestException(
          `لا يمكن الترحيل — الحالة الحالية: ${now?.status ?? 'unknown'}`,
        );
      }

      // ─── خصم الكرتون ───
      for (const c of dp.cartonUsage) {
        requireItem(c, 'كرتون');
        if (!c.itemId) continue; // qty=0, nothing to do
        const wh = c.warehouseId ?? mainWh.id;
        await tx.stockMovement.create({
          data: {
            tenantId,
            type: 'OUT',
            itemId: c.itemId,
            fromWarehouseId: wh,
            quantity: c.quantity,
            reasonCode: 'PROD_CARTON',
            refType: 'DailyProduction',
            refId: dp.id,
            notes: `سحب كرتون: ${c.itemName}`,
            performedById: userId,
          },
        });
        const eff_c = await this.adjustStock(tx, tenantId, c.itemId, wh, -Number(c.quantity), { allowNegative: allowShortage });
        await this.recordStockAudit(tx, {
          tenantId, dailyProductionId: dp.id, itemId: c.itemId,
          itemName: c.itemName ?? '', section: 'كرتون',
          quantityRequested: Number(c.quantity),
          previousStock: eff_c.before, resultingStock: eff_c.after,
          postingMode: mode, postedById: userId,
        });
      }

      // ─── خصم الألمنيوم ───
      for (const a of dp.aluminumUsage) {
        requireItem(a, 'ألمنيوم');
        if (!a.itemId) continue;
        const wh = a.warehouseId ?? mainWh.id;
        await tx.stockMovement.create({
          data: {
            tenantId,
            type: 'OUT',
            itemId: a.itemId,
            fromWarehouseId: wh,
            quantity: a.quantity,
            reasonCode: 'PROD_ALUMINUM',
            refType: 'DailyProduction',
            refId: dp.id,
            notes: `سحب ألمنيوم: ${a.itemName}`,
            performedById: userId,
          },
        });
        const eff_a = await this.adjustStock(tx, tenantId, a.itemId, wh, -Number(a.quantity), { allowNegative: allowShortage });
        await this.recordStockAudit(tx, {
          tenantId, dailyProductionId: dp.id, itemId: a.itemId,
          itemName: a.itemName ?? '', section: 'ألمنيوم',
          quantityRequested: Number(a.quantity),
          previousStock: eff_a.before, resultingStock: eff_a.after,
          postingMode: mode, postedById: userId,
        });
      }

      // ─── خصم الحليب ───
      for (const m of dp.milkUsage) {
        requireItem(m, 'حليب');
        if (!m.itemId) continue;
        const wh = m.warehouseId ?? mainWh.id;
        await tx.stockMovement.create({
          data: {
            tenantId,
            type: 'OUT',
            itemId: m.itemId,
            fromWarehouseId: wh,
            quantity: m.quantity,
            reasonCode: 'PROD_MILK',
            refType: 'DailyProduction',
            refId: dp.id,
            notes: `سحب حليب: ${m.itemName ?? ''} (${m.count} عبوة)`,
            performedById: userId,
          },
        });
        const eff_m = await this.adjustStock(tx, tenantId, m.itemId, wh, -Number(m.quantity), { allowNegative: allowShortage });
        await this.recordStockAudit(tx, {
          tenantId, dailyProductionId: dp.id, itemId: m.itemId,
          itemName: m.itemName ?? '', section: 'حليب',
          quantityRequested: Number(m.quantity),
          previousStock: eff_m.before, resultingStock: eff_m.after,
          postingMode: mode, postedById: userId,
        });
      }

      // ─── حساب تكلفة الإنتاج للكرتون الواحد ───
      // Real FIFO cost basis: consume raw PurchaseBatch (oldest first)
      // via fifo.consumeForProduction, sum the actual costs, and divide
      // by total cartons produced. This is deterministic — the exact
      // batches consumed are recorded in ProductionCostAllocation so
      // cancel() can reverse them precisely and downstream sales of
      // produced cartons record a real COGS.
      //
      // The consume calls also decrement PurchaseBatch.remaining so
      // StockLevel and Σ(remaining) stay reconciled per item.
      const totalCartons = dp.produced.reduce(
        (s: number, p: any) => s + Number(p.cartonsTotal ?? 0),
        0,
      );
      const rawRows: Array<{ itemId: string; qty: number }> = [];
      for (const c of dp.cartonUsage)   if (c.itemId) rawRows.push({ itemId: c.itemId, qty: Number(c.quantity) });
      for (const a of dp.aluminumUsage) if (a.itemId) rawRows.push({ itemId: a.itemId, qty: Number(a.quantity) });
      for (const m of dp.milkUsage)     if (m.itemId) rawRows.push({ itemId: m.itemId, qty: Number(m.quantity) });

      // ─── ترتيب حتمي للقفل (deterministic lock ordering) ───
      // كل استهلاك يأخذ قفل صفوف على دفعات الصنف حتى نهاية المعاملة.
      // لو رحّلت وردية أ المواد بالترتيب (X ثم Y) ورحّلت وردية ب بالترتيب
      // (Y ثم X) في نفس اللحظة، لأمسكت كل واحدة بقفل تنتظره الأخرى —
      // deadlock. الترتيب حسب itemId يجعل كل المعاملات تطلب الأقفال بنفس
      // التسلسل، فيستحيل تكوّن دورة انتظار.
      rawRows.sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));

      // ═══════════════════════════════════════════════════════════
      //  تصنيف التوالف (القرار المحاسبي المعتمد)
      // ═══════════════════════════════════════════════════════════
      //  توالف مواد خام  → تستهلك دفعات المادة الخام نفسها، وتكلفتها
      //                     تُحمَّل على تكلفة الإنتاج (هدر طبيعي: المادة
      //                     دخلت العملية فعلاً ولم تخرج منتجاً).
      //  توالف منتج تام → تستهلك دفعات المنتج التام، وتُسجَّل خسارة
      //                     منفصلة ولا تُحمَّل على تكلفة باقي الكراتين —
      //                     الكرتون التالف كُلِّف مرة واحدة عند إنتاجه،
      //                     وتحميله ثانية على إخوته ازدواج في الاحتساب.
      const producedItemIds = new Set<string>(
        dp.produced.map((p: any) => p.itemId).filter(Boolean),
      );
      const wasteRows: any[] = dp.wastages ?? [];
      const finishedWaste = wasteRows.filter(
        (w: any) => w.itemId && producedItemIds.has(w.itemId),
      );
      const rawWaste = wasteRows.filter(
        (w: any) => w.itemId && !producedItemIds.has(w.itemId),
      );

      let rawCostTotal = 0;
      for (const r of rawRows) {
        // If FIFO batches are insufficient (which shouldn't happen —
        // adjustStock above already caught StockLevel shortages), the
        // fifo service throws and the outer $transaction rolls back.
        const consumed = await this.fifo.consumeForProduction(
          tenantId,
          {
            dailyProductionId: dp.id,
            rawItemId: r.itemId,
            quantity: r.qty,
            allowShortage,
          },
          tx,
        );
        rawCostTotal += consumed.totalCost;
      }
      // توالف المواد الخام — تُستهلك من دفعات المادة نفسها وتدخل في
      // أساس التكلفة. لا بد أن تسبق حساب perCartonCost أدناه.
      let rawWasteCost = 0;
      const rawWasteSorted = [...rawWaste].sort((a, b) =>
        a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0,
      );
      for (const w of rawWasteSorted) {
        const qty = Number(w.quantity ?? 0);
        if (!(qty > 0)) continue;
        const consumed = await this.fifo.consumeForProduction(
          tenantId,
          {
            dailyProductionId: dp.id,
            rawItemId: w.itemId,
            quantity: qty,
            allowShortage,
            allocationMethod: 'FIFO_WASTE_RAW',
          },
          tx,
        );
        rawWasteCost += consumed.totalCost;
      }
      rawCostTotal += rawWasteCost;

      const perCartonCost = totalCartons > 0 && rawCostTotal > 0
        ? rawCostTotal / totalCartons
        : null; // fallback per item below

      // ─── إضافة المنتجات للمخزون النهائي + دفعة FIFO ───
      for (const p of dp.produced) {
        const qty = Number(p.cartonsTotal ?? 0);
        if (qty > 0 && !p.itemId) {
          throw new BadRequestException(
            `منتج: "${p.itemName ?? '(بدون اسم)'}" — يجب اختيار الصنف من قائمة المخزون قبل الترحيل`,
          );
        }
        if (!p.itemId) continue;
        const wh = p.warehouseId ?? mainWh.id;
        // الكمية = مجموع الكراتين (نسجّل بعدد الكراتين كوحدة قياس)
        await tx.stockMovement.create({
          data: {
            tenantId,
            type: 'IN',
            itemId: p.itemId,
            toWarehouseId: wh,
            quantity: new Prisma.Decimal(qty),
            reasonCode: 'PROD_OUTPUT',
            refType: 'DailyProduction',
            refId: dp.id,
            notes: `إنتاج: ${p.itemName} (${qty} كرتون)`,
            performedById: userId,
          },
        });
        await this.adjustStock(tx, tenantId, p.itemId, wh, qty);

        // Create a PurchaseBatch for the produced cartons so a later
        // sale of this SKU can consume FIFO and record a real COGS.
        // Without this batch, sales of produced cartons record COGS=0
        // and gross-profit reports are silently inflated.
        if (qty > 0) {
          let unitCost = perCartonCost;
          if (unitCost === null) {
            const producedItem = await tx.item.findUnique({ where: { id: p.itemId } });
            unitCost = producedItem?.avgCost
              ? Number(producedItem.avgCost)
              : Number(producedItem?.costPrice ?? 0);
          }
          await tx.purchaseBatch.create({
            data: {
              tenantId,
              itemId: p.itemId,
              batchNumber: null,
              purchaseDate: new Date(),
              quantity: new Prisma.Decimal(qty),
              remaining: new Prisma.Decimal(qty),
              unitCost: new Prisma.Decimal(unitCost),
              sourceType: 'PRODUCTION',
              sourceRefId: dp.id,
              createdById: userId,
            },
          });
        }
      }

      // ─── خصم التوالف من الرصيد + استهلاك دفعات المنتج التام ───
      // الرصيد يُخصم لكل التوالف هنا كما كان. الجديد: توالف المنتج التام
      // تستهلك أيضاً دفعات FIFO الخاصة به — وهي أُنشئت للتو في حلقة
      // الإنتاج أعلاه، ولهذا يأتي هذا الجزء بعدها وليس قبلها.
      let finishedWasteCost = 0;
      const finishedWasteIds = new Set(finishedWaste.map((w: any) => w.id));
      for (const w of dp.wastages) {
        requireItem(w, 'توالف');
        if (!w.itemId) continue;
        const wh = w.warehouseId ?? mainWh.id;
        await tx.stockMovement.create({
          data: {
            tenantId,
            type: 'WASTE',
            itemId: w.itemId,
            fromWarehouseId: wh,
            quantity: w.quantity,
            reasonCode: 'PROD_WASTE',
            refType: 'DailyProduction',
            refId: dp.id,
            notes: `توالف: ${w.itemName} — ${w.reason ?? ''}`,
            performedById: userId,
          },
        });
        const eff_w = await this.adjustStock(tx, tenantId, w.itemId, wh, -Number(w.quantity), { allowNegative: allowShortage });
        await this.recordStockAudit(tx, {
          tenantId, dailyProductionId: dp.id, itemId: w.itemId,
          itemName: w.itemName ?? '', section: 'توالف',
          quantityRequested: Number(w.quantity),
          previousStock: eff_w.before, resultingStock: eff_w.after,
          postingMode: mode, postedById: userId,
        });

        // منتج تام تالف → استهلك دفعته الخاصة بتكلفتها هي، وسجّلها خسارة
        // مستقلة. لا تُضاف إلى rawCostTotal: الكرتون كُلِّف عند إنتاجه،
        // وإعادة تحميله على باقي الكراتين ازدواج في الاحتساب.
        if (finishedWasteIds.has(w.id)) {
          const qty = Number(w.quantity ?? 0);
          if (qty > 0) {
            const consumed = await this.fifo.consumeForProduction(
              tenantId,
              {
                dailyProductionId: dp.id,
                rawItemId: w.itemId,
                quantity: qty,
                allowShortage,
                allocationMethod: 'FIFO_WASTE_FINISHED',
              },
              tx,
            );
            finishedWasteCost += consumed.totalCost;
          }
        }
      }

      // Flip claim → final POSTED (postedAt/postedById already set by claim).
      const record = await tx.dailyProduction.update({
        where: { id },
        data: { status: 'POSTED' },
      });

      return {
        success: true,
        mode,
        warnings: shortages,
        production: record,
      };
    });
  }

  // ─── Cancel (إرجاع المخزون) ───────────────────────
  /**
   * Reverses every StockMovement written by post() and flips the record
   * to CANCELLED.
   *
   * SINGLE-WAREHOUSE REVERSAL RULE
   * ------------------------------
   * The reversal StockMovement preserves the original warehouseId for
   * audit continuity (so pre-consolidation posts still name FIN/BULK/PKG
   * in reports that group by warehouse). BUT the actual balance
   * adjustment is applied to MAIN — because after the consolidation
   * migration the historical warehouses hold quantity=0 and are marked
   * inactive. Writing the reversal delta back into those zeroed rows
   * would create phantom stock nobody sees on /inventory.
   *
   * This rule is a no-op for posts made AFTER the fix went live, because
   * their movements already name MAIN — mainWh.id === m.fromWarehouseId.
   */
  async cancel(tenantId: string, userId: string, id: string) {
    const dp = await this.get(tenantId, id);
    if (dp.status !== 'POSTED') {
      throw new BadRequestException('لا يمكن إلغاء سجل لم يتم ترحيله');
    }

    // Resolve MAIN once, outside the loop.
    const mainWh = await this.resolveMainWarehouse(tenantId);

    return this.prisma.$transaction(async (tx) => {
      // ─── Reverse FIFO first ────────────────────────────────
      // Restore PurchaseBatch.remaining for every raw material the
      // production consumed (via ProductionCostAllocation) and delete
      // the allocations. This is a no-op for pre-B1 productions —
      // their POST didn't create allocations, so reverseForProduction
      // finds nothing to reverse. Safe either way.
      await this.fifo.reverseForProduction(tenantId, id, tx);

      // ─── Reverse the produced PurchaseBatch ─────────────────
      // Delete any PurchaseBatch we created for this production. We
      // check remaining==quantity — if any of the produced cartons
      // have already been sold, remaining is lower and reversal is
      // unsafe (would leave the sale's SaleCostAllocation dangling).
      // In that case we refuse to cancel.
      const producedBatches = await tx.purchaseBatch.findMany({
        where: { tenantId, sourceType: 'PRODUCTION', sourceRefId: id },
      });
      for (const b of producedBatches) {
        if (Number(b.remaining) + 1e-9 < Number(b.quantity)) {
          throw new BadRequestException(
            'لا يمكن الإلغاء — بعض الكراتين المنتجة قد بيعت بالفعل. أنشئ حركة إرجاع بدلاً من الإلغاء.',
          );
        }
        await tx.purchaseBatch.delete({ where: { id: b.id } });
      }

      const movements = await tx.stockMovement.findMany({
        where: { tenantId, refType: 'DailyProduction', refId: id },
      });

      for (const m of movements) {
        const reverseType =
          m.type === 'IN' ? 'OUT' : m.type === 'OUT' ? 'IN' : 'IN';

        // Audit trail: name the historical warehouse the original
        // movement referenced (or MAIN if the movement carried none).
        const auditFromWh =
          reverseType === 'OUT'
            ? m.toWarehouseId ?? m.fromWarehouseId
            : null;
        const auditToWh =
          reverseType === 'IN'
            ? m.fromWarehouseId ?? m.toWarehouseId
            : null;

        await tx.stockMovement.create({
          data: {
            tenantId,
            type: reverseType,
            itemId: m.itemId,
            fromWarehouseId: auditFromWh,
            toWarehouseId: auditToWh,
            quantity: m.quantity,
            reasonCode: 'REVERSAL',
            refType: 'DailyProduction-Reversal',
            refId: id,
            notes: `إلغاء حركة: ${m.notes ?? ''}`,
            performedById: userId,
          },
        });

        if (m.itemId) {
          const delta =
            reverseType === 'IN' ? Number(m.quantity) : -Number(m.quantity);
          // BALANCE update always targets MAIN — see rationale above.
          // Never route the delta into the historical warehouseId.
          await this.adjustStock(tx, tenantId, m.itemId, mainWh.id, delta);
        }
      }

      return tx.dailyProduction.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });
    });
  }

  // ─── Daily Report ─────────────────────────────────
  /**
   * SHARED "today's production" aggregator — single source of truth used by:
   *   - Dashboard executive card (الإنتاج اليوم)
   *   - Production Days page KPIs
   *   - Daily production summary
   *   - Reports & printing
   *   - Financial control center
   *
   * Contract:
   *   totalProduction  = Σ produced[].cartonsTotal for every DailyProduction
   *                      record whose productionDate falls between local
   *                      start-of-day and local end-of-day (Jordan timezone,
   *                      configurable via TZ_OFFSET_MIN env var). Numeric
   *                      strings are coerced to Number and null/undefined
   *                      values are treated as 0.
   *   productionDayCount = number of DailyProduction rows for today
   *   machineRunCount    = number of DailyProduction rows that had at least
   *                        one produced item
   *   wastePercentage    = totalWaste / (totalProduction + totalWaste)
   *   productionDate     = the local-date this bucket represents (YYYY-MM-DD)
   *
   * Status handling: BOTH `DRAFT` and `POSTED` records count. If a quantity
   * has been entered on the production day it represents real produce; the
   * "Draft" flag only means it hasn't been posted to inventory yet. The
   * user's Production Days page and the Dashboard must NOT diverge on this.
   *
   * Timezone: dates stored in `productionDate` are naïve day-buckets
   * (already normalised to local start-of-day by create()/update()). To
   * find "today" we compute the current local-day in Jordan (+03:00 by
   * default, override with TZ_OFFSET_MIN) and match records at that day.
   */
  /**
   * SINGLE SOURCE OF TRUTH for "Today's Production" across the system.
   *
   *   Dashboard  → this method
   *   /production/summary  → getDailySummary()   ← the ORIGINAL rule
   *   Reports    → this method (via /dashboard/executive) or getDailySummary
   *   PDF/Print  → same numbers guaranteed
   *
   * IMPLEMENTATION NOTE
   * -------------------
   * Rather than re-implement the aggregation and risk divergence from
   * the summary page (which is what happened in commit 960c394 —
   * a UTC vs Jordan-offset window mismatch could exclude records that
   * /production/summary would include), this method delegates to
   * `getDailySummary()` and simply reshapes the return value. The
   * numbers on the Dashboard are therefore identical to what the
   * user sees on /production/summary by construction — divergence
   * is impossible.
   *
   * Timezone handling for the DEFAULT date:
   *   Jordan (Asia/Amman) is UTC+3 year-round (no DST since 2022-10-28).
   *   If the caller does not supply a date, we pick "today in Jordan"
   *   by shifting current UTC by +180 minutes and taking the calendar
   *   date. `getDailySummary` then internally uses server-local
   *   midnight as its window edges — on Render (UTC) that is the
   *   same window used when the user manually opens /production/summary
   *   for today, so the totals match exactly.
   */
  async getTodayProductionSummary(
    tenantId: string,
    now: Date = new Date(),
  ) {
    // Compute "today in Jordan" as YYYY-MM-DD (defensive against
    // server timezone). We only use this to build the string that
    // getDailySummary parses back into a Date, keeping the window
    // logic in ONE place.
    const OFFSET_MIN = Number(process.env.TZ_OFFSET_MIN ?? 180);
    const localMs = now.getTime() + OFFSET_MIN * 60_000;
    const local = new Date(localMs);
    const y = local.getUTCFullYear();
    const m = String(local.getUTCMonth() + 1).padStart(2, '0');
    const d = String(local.getUTCDate()).padStart(2, '0');
    const isoDate = `${y}-${m}-${d}`;

    // Delegate — same query, same rule, same numbers as /production/summary.
    const summary = await this.getDailySummary(tenantId, { date: isoDate });

    const totalProduction = Number(summary?.totals?.cartons ?? 0);
    const totalWaste = Number(summary?.totals?.waste ?? 0);
    // wasteRate from summary is a PERCENT (e.g., 3.5 for 3.5%). The
    // Dashboard binds `wastePct` and multiplies by 100 to display, so
    // we return the FRACTION (0.035) to preserve that display contract.
    const wasteRatePercent = Number(summary?.totals?.wasteRate ?? 0);
    const wastePercentage = wasteRatePercent / 100;

    return {
      productionDate: isoDate,
      totalProduction,
      productionDayCount: Number(summary?.recordsCount ?? 0),
      machineRunCount: Number(summary?.recordsCount ?? 0),
      totalWaste,
      wastePercentage,
      // Legacy field name kept so the Dashboard's existing
      // `data.production.totalOutput` binding continues to work — new
      // callers should read `totalProduction` instead.
      totalOutput: totalProduction,
      wastePct: wastePercentage,
      // Extra pass-through for future FE cards.
      byItem: summary?.byItem ?? {},
      rawMilkKg: Number(summary?.totals?.rawMilkKg ?? 0),
    };
  }

  async dailyReport(tenantId: string, date: Date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86400000);

    // الملغاة (CANCELLED) مستبعدة: عند الإلغاء تُعكس حركات المخزون ودفعات
    // FIFO بالكامل (راجع cancel())، فاحتسابها هنا يضخّم إنتاج اليوم والهدر
    // بكميات لم تعد موجودة فعلياً. نفس الفلتر المستخدم في
    // getCostAndWasteReport و getCogsProfit.
    // المسودات (DRAFT) تبقى محتسبة عمداً — هذه شاشة تشغيلية تعرض عمل اليوم
    // الجاري؛ التوزيع حسب الحالة مرفق في counts أدناه.
    const records = await this.prisma.dailyProduction.findMany({
      where: {
        tenantId,
        productionDate: { gte: start, lt: end },
        status: { not: 'CANCELLED' },
      },
      include: {
        cartonUsage: true,
        aluminumUsage: true,
        milkUsage: true,
        produced: true,
        wastages: true,
      },
    });

    // مجموع الإنتاج اليومي حسب الصنف
    const productionTotals: Record<string, number> = {};
    const wasteTotals: Record<string, number> = {};
    let totalCartons = 0;
    let totalMilk = 0;
    let totalAluminum = 0;
    let totalCartonUsage = 0;

    for (const r of records) {
      for (const p of r.produced) {
        productionTotals[p.itemName] =
          (productionTotals[p.itemName] ?? 0) + p.cartonsTotal;
        totalCartons += p.cartonsTotal;
      }
      for (const w of r.wastages) {
        wasteTotals[w.itemName] =
          (wasteTotals[w.itemName] ?? 0) + Number(w.quantity);
      }
      totalMilk += r.milkUsage.reduce((s, m) => s + Number(m.quantity), 0);
      totalAluminum += r.aluminumUsage.reduce((s, a) => s + Number(a.quantity), 0);
      totalCartonUsage += r.cartonUsage.reduce((s, c) => s + Number(c.quantity), 0);
    }

    return {
      date: start.toISOString().slice(0, 10),
      recordsCount: records.length,
      // توزيع الحالات — يوضّح للمستخدم أن الأرقام تشمل مسودات لم تُرحَّل بعد،
      // بدل أن يخمّن. الملغاة غير محتسبة أصلاً في records.
      counts: {
        draft: records.filter((r) => r.status === 'DRAFT').length,
        posted: records.filter((r) => r.status === 'POSTED').length,
      },
      records,
      summary: {
        totalCartons,
        totalMilk,
        totalAluminum,
        totalCartonUsage,
        productionByItem: productionTotals,
        wasteByItem: wasteTotals,
      },
    };
  }

  // ─── Daily Summary (تقرير ملخص بتفصيل الماكينات) ──
  /**
   * ملخص إنتاج يوم كامل: إجمالي الإنتاج + المنتجات + المواد الخام + نسبة الفاقد.
   * كل خطوط الإنتاج تُعامَل كوحدة موحدة (لا تفصيل ماكينات).
   */
  async getDailySummary(
    tenantId: string,
    opts: { date?: string; itemName?: string } = {},
  ) {
    const date = opts.date ? new Date(opts.date) : new Date();
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86400000);
    const round = (n: number, d = 2) =>
      Math.round(n * Math.pow(10, d)) / Math.pow(10, d);

    // انظر التعليق في dailyReport: الملغاة مستبعدة لأن حركاتها معكوسة،
    // والمسودات تبقى ظاهرة لأن هذه بطاقة تشغيلية ليوم العمل الجاري.
    const records = await this.prisma.dailyProduction.findMany({
      where: {
        tenantId,
        productionDate: { gte: start, lt: end },
        status: { not: 'CANCELLED' },
      },
      include: {
        cartonUsage: true,
        aluminumUsage: true,
        milkUsage: true,
        produced: true,
        wastages: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const filterItem = (p: any) =>
      !opts.itemName || p.itemName?.includes(opts.itemName);

    let totalCartons = 0;
    let totalMilk = 0;
    let totalAluminum = 0;
    let totalCartonUsage = 0;
    let totalWaste = 0;
    const byItem: Record<string, { totalCartons: number }> = {};
    const itemsProduced = new Set<string>();
    const notes: string[] = [];

    // ─── إجمالي الحليب بالكيلو ─────────────────────────────────────
    // كان هنا `const BAG_KG = 25` يعيد حساب الكمية من count ويتجاهل
    // quantity المخزَّنة — أي أن التقرير كان يتجاهل ما خُصم فعلاً من
    // المخزون، ولو عدّل المشغّل خانة الكيلو يدوياً لضاع تعديله.
    //
    // الآن: quantity هي مصدر الحقيقة (مخزَّنة بوحدة الصنف، محوّلة على
    // الخادم مع لقطة المعامل). عدد الأكياس يُجمَع للعرض فقط، ومعامل
    // التحويل يُقرأ من السطر نفسه لا من ثابت في الشيفرة.
    let totalMilkKg = 0;
    let totalMilkBags = 0;
    const factorsSeen = new Set<number>();
    let legacyFactorRows = 0;
    for (const r of records) {
      if (r.notes?.trim()) notes.push(`${r.shift || ''} — ${r.notes}`);
      for (const m of r.milkUsage as any[]) {
        const c = Number(m.count || 0);
        const q = Number(m.quantity || 0);
        totalMilkBags += c;
        totalMilkKg += q;
        if (m.unitFactor != null) factorsSeen.add(Number(m.unitFactor));
        if (m.factorSource === 'LEGACY_DEFAULT') legacyFactorRows++;
        totalMilk += q; // للتوافق الرجعي (المجموع الخام)
      }
      totalAluminum += r.aluminumUsage.reduce((s, a) => s + Number(a.quantity || 0), 0);
      totalCartonUsage += r.cartonUsage.reduce((s, c) => s + Number(c.quantity || 0), 0);
      totalWaste += r.wastages.reduce((s, w) => s + Number(w.quantity || 0), 0);

      for (const p of r.produced.filter(filterItem)) {
        const item = p.itemName || '(بدون اسم)';
        itemsProduced.add(item);
        const c = Number(p.cartonsTotal || 0);
        totalCartons += c;
        if (!byItem[item]) byItem[item] = { totalCartons: 0 };
        byItem[item].totalCartons += c;
      }
    }

    // نستخدم totalMilkKg الفعلي في نسب الفاقد والإنتاج/المدخل
    const wasteRate = totalMilkKg > 0 ? round((totalWaste / totalMilkKg) * 100, 2) : 0;
    const inputOutputRatio = totalMilkKg > 0 ? round(totalCartons / totalMilkKg, 4) : 0;

    return {
      date: start.toISOString().slice(0, 10),
      filter: { itemName: opts.itemName ?? null },
      recordsCount: records.length,
      // انظر dailyReport: الملغاة مستبعدة، والمسودات محتسبة ومعلَنة هنا.
      counts: {
        draft: records.filter((r) => r.status === 'DRAFT').length,
        posted: records.filter((r) => r.status === 'POSTED').length,
      },
      itemsProduced: Array.from(itemsProduced).sort(),
      totals: {
        cartons: totalCartons,
        rawMilk: round(totalMilk, 2),
        // ─── جديد: إجمالي الحليب بالكيلو (1 كيس = 25 كغ) ─
        rawMilkKg: round(totalMilkKg, 2),
        milkBags: totalMilkBags,
        // المعامل الفعلي المستخدم في السطور، لا رقم ثابت. null إذا اختلفت
        // الأصناف في معاملها — عندها لا يوجد "وزن كيس" واحد يُعرض.
        bagWeightKg: factorsSeen.size === 1 ? [...factorsSeen][0] : null,
        // عدد السطور التي استُخدم فيها الافتراضي القديم (25) لأن الصنف
        // غير مُعدّ. صفر = كل الأصناف مضبوطة.
        legacyFactorRows,
        aluminum: round(totalAluminum, 2),
        cartonUsage: round(totalCartonUsage, 2),
        waste: round(totalWaste, 2),
        wasteRate,
        inputOutputRatio,
      },
      byItem,
      notes,
      records: records.map((r) => ({
        id: r.id,
        shift: r.shift,
        operatorName: r.operatorName,
        status: r.status,
        notes: r.notes,
      })),
    };
  }

  // ─── Warehouse balance (للعرض في شاشة الإنتاج) ────
  /**
   * يرجع رصيد المخزون الحالي لمجموعات:
   *   - milk (الحليب الخام)
   *   - carton (الكرتون)
   *   - aluminum (الألمنيوم)
   * (يقرأ من جدول Item + StockLevel)
   */
  async computeWarehouseBalance(tenantId: string) {
    const items = await this.prisma.item.findMany({
      where: { tenantId, active: true },
      include: { stockLevels: true },
    });

    const milk: any[] = [];
    const carton: any[] = [];
    const aluminum: any[] = [];

    for (const it of items) {
      const total = it.stockLevels.reduce((s, sl) => s + Number(sl.quantity), 0);
      const row = {
        id: it.id,
        sku: it.sku,
        name: it.name,
        unit: it.unit,
        balance: total,
      };
      // تصنيف بناء على SKU prefix أو الاسم
      if (it.sku.startsWith('RAW-MILK') || it.name.includes('حليب خام')) {
        milk.push(row);
      } else if (it.sku.startsWith('CTN') || it.name.includes('كرتون')) {
        carton.push(row);
      } else if (it.sku.startsWith('ALU') || it.name.includes('ألمنيوم')) {
        aluminum.push(row);
      }
    }

    return { milk, carton, aluminum };
  }

  // ─── Helpers ──────────────────────────────────────
  /**
   * Resolve the single operational warehouse (code=MAIN). Auto-creates
   * it on first use so a freshly-provisioned tenant is never blocked
   * from posting production. Mirrors InventoryService.resolveMainWarehouse
   * so the two modules always converge on the same warehouse.
   */
  /**
   * Resolve the single operational warehouse (code=MAIN), creating it if
   * absent.
   *
   * NOTE (incident 2026-08-16): this used to fall back to the OLDEST
   * ACTIVE warehouse when MAIN was missing. On a database where the
   * single-warehouse consolidation had not run, that silently bound every
   * write to a legacy warehouse (BULK) while the UI kept summing across
   * all warehouses — wrong adjustment arithmetic, production decrementing
   * a warehouse that held none of the stock, and no error anywhere. A
   * missing MAIN must never be papered over with an arbitrary warehouse:
   * we create the real thing instead.
   */
  private async resolveMainWarehouse(tenantId: string) {
    const wh = await this.prisma.warehouse.findFirst({
      where: { tenantId, code: 'MAIN' },
    });
    if (wh) return wh;
    // Not found — create it race-safely. Two concurrent callers landing
    // here both resolve to the SAME row because of @@unique([tenantId,
    // code]); a plain create() would make the loser throw P2002. The
    // read above keeps the hot path a single SELECT.
    return this.prisma.warehouse.upsert({
      where: { tenantId_code: { tenantId, code: 'MAIN' } },
      update: {},
      create: { tenantId, code: 'MAIN', name: 'المخزن الرئيسي', type: 'GENERAL' },
    });
  }

  /**
   * Adjust a single StockLevel row inside a transaction.
   *
   * PREVIOUS BEHAVIOUR (buggy): silently clamped to zero on shortage
   * (`Math.max(0, newQty)`), and silently ignored decrements when no
   * row existed at all. Both patterns hid aluminum-not-deducted and
   * over-sell scenarios — the ledger showed movement while the balance
   * never actually dropped.
   *
   * NEW BEHAVIOUR: throw a BadRequestException on shortage so the
   * enclosing $transaction rolls back cleanly. On a decrement into a
   * non-existent row we throw with the same shape (would produce a
   * negative balance if we created it).
   */
  /**
   * Apply a stock delta and report what it did.
   *
   * `allowNegative` is the WARNING_MODE / OVERRIDE_MODE switch: the
   * balance is driven below zero instead of throwing, so a real factory
   * can record production it has physically completed and correct the
   * inventory afterwards. In STRICT_MODE the flag is false and this
   * behaves exactly as it always has.
   *
   * Returns { before, after } so the caller can write an audit row
   * without re-reading the balance.
   */
  private async adjustStock(
    tx: any,
    tenantId: string,
    itemId: string,
    warehouseId: string,
    delta: number,
    opts: { allowNegative?: boolean } = {},
  ): Promise<{ before: number; after: number }> {
    const existing = await tx.stockLevel.findFirst({
      where: { itemId, warehouseId, batchId: null },
    });

    if (existing) {
      const before = Number(existing.quantity);
      const newQty = before + delta;
      if (newQty < 0 && !opts.allowNegative) {
        const item = await tx.item.findUnique({ where: { id: itemId } });
        throw new BadRequestException(
          `المخزون لا يكفي للصنف "${item?.name ?? itemId}" (المتاح: ${existing.quantity}، المطلوب سحبه: ${Math.abs(delta)})`,
        );
      }
      await tx.stockLevel.update({
        where: { id: existing.id },
        data: { quantity: new Prisma.Decimal(newQty) },
      });
      return { before, after: newQty };
    }

    if (delta > 0) {
      await tx.stockLevel.create({
        data: {
          tenantId,
          itemId,
          warehouseId,
          quantity: new Prisma.Decimal(delta),
        },
      });
      return { before: 0, after: delta };
    }

    if (delta < 0) {
      if (!opts.allowNegative) {
        const item = await tx.item.findUnique({ where: { id: itemId } });
        throw new BadRequestException(
          `المخزون لا يكفي للصنف "${item?.name ?? itemId}" (المتاح: 0، المطلوب سحبه: ${Math.abs(delta)})`,
        );
      }
      // No row yet and we are permitted to go negative — materialise the
      // deficit so it is visible on the balance screen.
      await tx.stockLevel.create({
        data: {
          tenantId,
          itemId,
          warehouseId,
          quantity: new Prisma.Decimal(delta),
        },
      });
      return { before: 0, after: delta };
    }

    return { before: existing ? Number((existing as any).quantity) : 0, after: 0 };
  }

  // ─── Posting-mode helpers ─────────────────────────────────────────
  /**
   * STRICT_MODE | WARNING_MODE | OVERRIDE_MODE, from TenantSetting.
   * Defaults to WARNING_MODE when the tenant has no settings row yet.
   */
  /** Public read for the settings screen. */
  async readPostingMode(tenantId: string) {
    return {
      mode: await this.getPostingMode(tenantId),
      availableModes: ['STRICT_MODE', 'WARNING_MODE', 'OVERRIDE_MODE'],
      descriptions: {
        STRICT_MODE: 'امنع الترحيل عند نقص المخزون',
        WARNING_MODE: 'اسمح بالترحيل مع إنشاء عجز وتسجيل تحذير (الافتراضي)',
        OVERRIDE_MODE: 'اسمح بالترحيل مع العجز للمدراء فقط',
      },
    };
  }

  /** Public write for the settings screen (MANAGER-guarded in the controller). */
  async writePostingMode(tenantId: string, userId: string, mode?: string) {
    const allowed = ['STRICT_MODE', 'WARNING_MODE', 'OVERRIDE_MODE'];
    if (!mode || !allowed.includes(mode)) {
      throw new BadRequestException(
        `وضع ترحيل غير مدعوم. القيم المسموحة: ${allowed.join(' | ')}`,
      );
    }
    await this.prisma.tenantSetting.upsert({
      where: { tenantId },
      create: { tenantId, productionPostingMode: mode, updatedById: userId } as any,
      update: { productionPostingMode: mode, updatedById: userId } as any,
    });
    return this.readPostingMode(tenantId);
  }

  private async getPostingMode(tenantId: string): Promise<string> {
    const s = await this.prisma.tenantSetting.findUnique({ where: { tenantId } });
    const mode = (s as any)?.productionPostingMode ?? 'WARNING_MODE';
    return ['STRICT_MODE', 'WARNING_MODE', 'OVERRIDE_MODE'].includes(mode)
      ? mode
      : 'WARNING_MODE';
  }

  /**
   * Read-only pass over every raw-material row, reporting which ones the
   * current balance cannot cover. Runs BEFORE the posting transaction so
   * the operator is asked up front rather than after a rollback.
   *
   * Quantities are aggregated per item: two carton rows for the same SKU
   * must be judged against the balance together, not independently.
   */
  private async detectShortages(
    tenantId: string,
    dp: any,
  ): Promise<
    Array<{
      type: string;
      item: string;
      itemId: string;
      section: string;
      requiredQuantity: number;
      availableQuantity: number;
      shortageQuantity: number;
    }>
  > {
    const needed = new Map<
      string,
      { itemId: string; itemName: string; section: string; qty: number }
    >();

    const collect = (rows: any[], section: string) => {
      for (const r of rows ?? []) {
        const qty = Number(r.quantity ?? 0);
        if (!r.itemId || qty <= 0) continue;
        const prev = needed.get(r.itemId);
        if (prev) prev.qty += qty;
        else
          needed.set(r.itemId, {
            itemId: r.itemId,
            itemName: r.itemName ?? '',
            section,
            qty,
          });
      }
    };

    collect(dp.cartonUsage, 'كرتون');
    collect(dp.aluminumUsage, 'ألمنيوم');
    collect(dp.milkUsage, 'حليب');
    collect(dp.wastages, 'توالف');

    // ─── ما هو "المتاح" فعلياً؟ ───────────────────────────────
    // كان هذا الفحص يقرأ StockLevel فقط، وهذا خطأ: الترحيل يستهلك
    // PurchaseBatch.remaining عبر FIFO، لا StockLevel. الطبقتان قد
    // تتباعدان — مثال حقيقي من الإنتاج: حليب خام برصيد StockLevel
    // = 40,000 بينما FIFO remaining = 0 (رصيد افتتاحي بلا دفعات).
    //
    // النتيجة كانت أن detectShortages لا يرى نقصاً إطلاقاً، فلا
    // STRICT_MODE يمنع ولا WARNING_MODE يحذّر، ثم يفشل الترحيل من داخل
    // المعاملة برسالة FIFO خام لا يفهمها المستخدم.
    //
    // المتاح الحقيقي = أصغر الطبقتين: لا يمكن استهلاك أكثر مما يسمح به
    // الرصيد، ولا أكثر مما تغطيه الدفعات.
    const out: any[] = [];
    for (const n of needed.values()) {
      const [stockAgg, fifoAgg] = await Promise.all([
        this.prisma.stockLevel.aggregate({
          where: { tenantId, itemId: n.itemId, batchId: null },
          _sum: { quantity: true },
        }),
        this.prisma.purchaseBatch.aggregate({
          where: { tenantId, itemId: n.itemId },
          _sum: { remaining: true },
        }),
      ]);

      const stockAvailable = Number(stockAgg._sum.quantity ?? 0);
      const fifoAvailable = Number(fifoAgg._sum.remaining ?? 0);
      const available = Math.min(stockAvailable, fifoAvailable);

      if (available + 1e-9 < n.qty) {
        out.push({
          type: 'INSUFFICIENT_STOCK',
          item: n.itemName,
          itemId: n.itemId,
          section: n.section,
          requiredQuantity: n.qty,
          availableQuantity: available,
          shortageQuantity: Math.round((n.qty - available) * 10000) / 10000,
          // أي الطبقتين هي القيد — يميّز "لا يوجد رصيد" عن "الرصيد موجود
          // لكن بلا دفعات تكلفة"، وهما حالتان تُعالَجان بشكل مختلف تماماً.
          limitedBy:
            fifoAvailable < stockAvailable ? 'FIFO_BATCHES' : 'STOCK_LEVEL',
          stockLevelAvailable: stockAvailable,
          fifoAvailable,
        });
      }
    }
    return out;
  }

  /** One audit row per item a posting touched. Never throws. */
  private async recordStockAudit(
    tx: any,
    row: {
      tenantId: string;
      dailyProductionId: string;
      itemId: string;
      itemName: string;
      section: string;
      quantityRequested: number;
      previousStock: number;
      resultingStock: number;
      postingMode: string;
      postedById?: string;
    },
  ) {
    const shortage = row.resultingStock < 0 ? Math.abs(row.resultingStock) : 0;
    await (tx as any).productionStockAudit.create({
      data: {
        tenantId: row.tenantId,
        dailyProductionId: row.dailyProductionId,
        itemId: row.itemId,
        itemName: row.itemName,
        section: row.section,
        quantityRequested: new Prisma.Decimal(row.quantityRequested),
        previousStock: new Prisma.Decimal(row.previousStock),
        resultingStock: new Prisma.Decimal(row.resultingStock),
        shortageQuantity: new Prisma.Decimal(shortage),
        warningType: shortage > 0 ? 'INSUFFICIENT_STOCK' : null,
        postingMode: row.postingMode,
        reason:
          shortage > 0
            ? `Negative stock created for item ${row.itemName} due to production posting`
            : null,
        postedById: row.postedById ?? null,
      },
    });
  }

  // Module-scoped rounder — mirrors `round` in fifo.service.ts.
  // Not a class member so it can be used inside object literals.
  // Kept local to avoid a stray helper file.
  //
  // (Declared at method-scope in getDailySummary too; harmless duplication.)
  //
  // ─── Cost & Waste Report (Blocker B3 fix) ─────────────────────────
  /**
   * SINGLE SOURCE OF TRUTH for the /reports "Cost & Waste" tab.
   *
   * Prior behaviour (FE-only): `producedQty × finished-item avgCost`
   * — a rough estimate that ignored the real raw-material cost booked
   * against each production via `ProductionCostAllocation`.
   *
   * New rule:
   *   Per DailyProduction:
   *     • productionCost = Σ ProductionCostAllocation.totalCost for this DP
   *       (the actual raw cost consumed via FIFO)
   *     • producedCartons = Σ ProductionProducedItem.cartonsTotal
   *     • wasteQty        = Σ ProductionWaste.quantity
   *     • wasteCost       = wasteQty * unitProductionCost
   *                          where unitProductionCost = productionCost / producedCartons
   *                          (waste is at production-cost basis — same rule finished
   *                          cartons use when they leave the shelf via sale).
   *
   * Rolled up per date range: sums of the above plus percentages.
   *
   * DailyProductions posted BEFORE Blocker B1 have no
   * ProductionCostAllocation rows. For those we surface the cost as 0
   * with a `legacy=true` flag so the FE can show a clear "pre-FIFO
   * historical row" indicator instead of a misleading approximation.
   */
  async getCostAndWasteReport(
    tenantId: string,
    opts: { from?: string; to?: string } = {},
  ) {
    const where: any = { tenantId, status: 'POSTED' };
    if (opts.from || opts.to) {
      where.productionDate = {};
      if (opts.from) where.productionDate.gte = new Date(opts.from);
      if (opts.to) {
        const t = new Date(opts.to); t.setDate(t.getDate() + 1);
        where.productionDate.lt = t;
      }
    }
    const productions = await this.prisma.dailyProduction.findMany({
      where,
      include: {
        produced: true,
        wastages: true,
      },
      orderBy: { productionDate: 'asc' },
    });
    if (productions.length === 0) {
      return {
        from: opts.from ?? null,
        to: opts.to ?? null,
        totals: {
          productionCost: 0,
          producedCartons: 0,
          wasteQty: 0,
          wasteCost: 0,
          wastePct: 0,
          legacyProductions: 0,
        },
        rows: [],
      };
    }

    // Batch-load allocations for every production in the window.
    const dpIds = productions.map((p) => p.id);
    const allocations: Array<{ dailyProductionId: string; totalCost: any }> =
      await (this.prisma as any).productionCostAllocation.findMany({
        where: { tenantId, dailyProductionId: { in: dpIds } },
        select: { dailyProductionId: true, totalCost: true, method: true },
      });

    // ── تكلفة التوالف من ما استُهلك فعلاً ────────────────────────────
    // كانت تُحسب: wasteQty × (تكلفة الإنتاج ÷ عدد الكراتين) — أي أن كل
    // توالف يُقيَّم بسعر كرتون تام. البيانات الحية تقول إن 8 من 13 سطر
    // توالف مواد خام (رولات ألمنيوم، كراتين)، فكان التقييم خاطئاً بالبُعد
    // نفسه: كمية بالكيلو أو بالحبة مضروبة بسعر كرتون.
    //
    // الآن تُجمع من ProductionCostAllocation حسب method:
    //   FIFO / FIFO_SHORTAGE                    → تكلفة الإنتاج
    //   FIFO_WASTE_RAW / ..._SHORTAGE           → توالف مواد خام (محمَّلة
    //                                             على تكلفة الإنتاج أيضاً)
    //   FIFO_WASTE_FINISHED / ..._SHORTAGE      → خسارة منتج تام مستقلة
    const isRawWaste = (m: string) => (m ?? '').startsWith('FIFO_WASTE_RAW');
    const isFinishedWaste = (m: string) => (m ?? '').startsWith('FIFO_WASTE_FINISHED');

    const costByDp = new Map<string, number>();
    const rawWasteByDp = new Map<string, number>();
    const finishedWasteByDp = new Map<string, number>();
    for (const a of allocations as any[]) {
      const v = Number(a.totalCost);
      const add = (m: Map<string, number>) =>
        m.set(a.dailyProductionId, (m.get(a.dailyProductionId) ?? 0) + v);
      if (isFinishedWaste(a.method)) {
        // خسارة مستقلة — لا تدخل تكلفة الإنتاج (منع الازدواج)
        add(finishedWasteByDp);
      } else {
        add(costByDp);
        if (isRawWaste(a.method)) add(rawWasteByDp);
      }
    }

    let totalCost = 0, totalCartons = 0, totalWasteQty = 0, totalWasteCost = 0;
    let totalRawWasteCost = 0, totalFinishedWasteCost = 0, estimatedWasteRows = 0;
    let legacyCount = 0;
    const rows = productions.map((p: any) => {
      const productionCost = costByDp.get(p.id) ?? 0;
      const producedCartons = p.produced.reduce(
        (s: number, x: any) => s + Number(x.cartonsTotal ?? 0), 0,
      );
      const wasteQty = p.wastages.reduce(
        (s: number, x: any) => s + Number(x.quantity ?? 0), 0,
      );
      const unitCost = producedCartons > 0 ? productionCost / producedCartons : 0;

      const rawWasteCost = rawWasteByDp.get(p.id) ?? 0;
      const finishedWasteCost = finishedWasteByDp.get(p.id) ?? 0;
      const measuredWasteCost = rawWasteCost + finishedWasteCost;

      // Sheets posted before waste consumed FIFO have no waste allocations.
      // Falling back to the old carton-cost approximation for those keeps
      // history readable, but it is flagged rather than presented as fact.
      const wasteCostIsMeasured = measuredWasteCost > 0 || wasteQty === 0;
      const wasteCost = wasteCostIsMeasured ? measuredWasteCost : wasteQty * unitCost;

      const legacy = productionCost === 0 && producedCartons > 0;
      if (legacy) legacyCount++;
      totalCost += productionCost;
      totalCartons += producedCartons;
      totalWasteQty += wasteQty;
      totalWasteCost += wasteCost;
      totalRawWasteCost += rawWasteCost;
      totalFinishedWasteCost += finishedWasteCost;
      if (!wasteCostIsMeasured) estimatedWasteRows++;
      return {
        productionId: p.id,
        productionDate: p.productionDate,
        productionCost,
        producedCartons,
        wasteQty,
        wasteCost,
        rawWasteCost,
        finishedWasteCost,
        wasteCostIsMeasured,
        unitCost,
        legacy, // true => posted before Blocker B1; no FIFO cost recorded
      };
    });

    const denom = totalCartons + totalWasteQty;
    const wastePct = denom > 0 ? (totalWasteQty / denom) * 100 : 0;
    const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
    const r2 = (n: number) => Math.round(n * 100) / 100;

    return {
      from: opts.from ?? null,
      to: opts.to ?? null,
      totals: {
        productionCost: r4(totalCost),
        producedCartons: totalCartons,
        wasteQty: totalWasteQty,
        wasteCost: r4(totalWasteCost),
        rawWasteCost: r4(totalRawWasteCost),
        finishedWasteCost: r4(totalFinishedWasteCost),
        wastePct: r2(wastePct),
        legacyProductions: legacyCount,
        // Sheets whose waste cost is still the old carton-cost estimate.
        estimatedWasteRows,
      },
      rows,
    };
  }

  async delete(tenantId: string, id: string) {
    const dp = await this.get(tenantId, id);
    if (dp.status === 'POSTED') {
      throw new BadRequestException(
        'لا يمكن الحذف — السجل مُرحَّل. ألغِه أولاً.',
      );
    }
    await this.prisma.dailyProduction.delete({ where: { id } });
    return { ok: true };
  }
}
