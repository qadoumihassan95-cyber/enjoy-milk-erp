import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Items CRUD ──────────────────────────────────
  /**
   * قائمة مُصفّحة للأصناف — تدعم البحث والفلترة و pagination.
   * تُرجع { items, total, hasMore, limit, offset }
   */
  async listItemsPaginated(
    tenantId: string,
    opts: { search?: string; type?: string; barcode?: string; limit?: number; offset?: number } = {},
  ) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
    const offset = Math.max(opts.offset ?? 0, 0);
    const where: any = {
      tenantId,
      active: true,
      ...(opts.type && { type: opts.type as any }),
      ...(opts.barcode ? { barcode: opts.barcode } : {}),
      ...(opts.search && {
        OR: [
          { name: { contains: opts.search, mode: 'insensitive' } },
          { sku: { contains: opts.search, mode: 'insensitive' } },
          { barcode: opts.search },
        ],
      }),
    };

    const [items, total] = await Promise.all([
      this.prisma.item.findMany({
        where,
        include: { stockLevels: { include: { warehouse: true } } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.item.count({ where }),
    ]);

    const mapped = items.map((it: any) => {
      const totalStock = it.stockLevels.reduce((s: number, sl: any) => s + Number(sl.quantity), 0);
      const isLow = it.reorderLevel != null && totalStock < Number(it.reorderLevel);
      return { ...it, totalStock, isLow };
    });

    return {
      items: mapped,
      total,
      limit,
      offset,
      hasMore: offset + mapped.length < total,
    };
  }

  /** بحث سريع بالباركود (فحص فوري للماسحات USB) */
  async findByBarcode(tenantId: string, barcode: string) {
    const item = await this.prisma.item.findFirst({
      where: { tenantId, active: true, barcode },
      include: { stockLevels: { include: { warehouse: true } } },
    });
    if (!item) return null;
    const totalStock = item.stockLevels.reduce((s: number, sl: any) => s + Number(sl.quantity), 0);
    return { ...item, totalStock };
  }

  async listItems(tenantId: string, opts: { search?: string; type?: string } = {}) {
    const items = await this.prisma.item.findMany({
      where: {
        tenantId,
        active: true,
        ...(opts.type && { type: opts.type as any }),
        ...(opts.search && {
          OR: [
            { name: { contains: opts.search, mode: 'insensitive' } },
            { sku: { contains: opts.search, mode: 'insensitive' } },
            { barcode: opts.search },
          ],
        }),
      },
      include: {
        stockLevels: { include: { warehouse: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return items.map((item) => {
      const totalStock = item.stockLevels.reduce(
        (sum, sl) => sum + Number(sl.quantity),
        0,
      );
      const isLow =
        item.reorderLevel != null && totalStock < Number(item.reorderLevel);

      return {
        ...item,
        totalStock,
        isLow,
      };
    });
  }

  async getItem(tenantId: string, id: string) {
    const item = await this.prisma.item.findFirst({
      where: { id, tenantId },
      include: {
        stockLevels: { include: { warehouse: true } },
        batches: { orderBy: { expiryDate: 'asc' } },
      },
    });
    if (!item) throw new NotFoundException('الصنف غير موجود');
    return item;
  }

  async createItem(tenantId: string, data: any) {
    // ─── Validation: تحقق من التكرار (الاسم/SKU/الباركود) داخل نفس الـ tenant ───
    const trimmedName = String(data.name || '').trim();
    if (!trimmedName) {
      throw new BadRequestException('اسم المادة مطلوب');
    }
    const sku = String(data.sku || '').trim() || undefined;
    const barcode = String(data.barcode || '').trim() || undefined;

    const dup = await this.prisma.item.findFirst({
      where: {
        tenantId,
        OR: [
          { name: trimmedName },
          ...(sku ? [{ sku }] : []),
          ...(barcode ? [{ barcode }] : []),
        ],
      },
    });
    if (dup) {
      if (dup.name === trimmedName) throw new BadRequestException('يوجد مادة بنفس الاسم');
      if (sku && dup.sku === sku) throw new BadRequestException('SKU مكرر');
      if (barcode && dup.barcode === barcode) throw new BadRequestException('الباركود مكرر');
    }

    return this.prisma.item.create({
      data: {
        tenantId,
        // SKU إجباري في الـ schema — نولّده إن لم يُعطَ
        sku: sku ?? `ITM-${Date.now().toString(36).toUpperCase()}`,
        barcode,
        name: trimmedName,
        type: data.type ?? 'CONSUMABLE',
        unit: data.unit ?? 'PCS',
        netWeightGrams: data.netWeightGrams,
        packagingFormat: data.packagingFormat,
        packsPerCarton: data.packsPerCarton,
        shelfLifeDays: data.shelfLifeDays,
        reorderLevel: data.reorderLevel ? new Prisma.Decimal(data.reorderLevel) : null,
        costPrice: data.costPrice ? new Prisma.Decimal(data.costPrice) : null,
        sellPrice: data.sellPrice ? new Prisma.Decimal(data.sellPrice) : null,
        minStock: data.minStock ? new Prisma.Decimal(data.minStock) : null,
        maxStock: data.maxStock ? new Prisma.Decimal(data.maxStock) : null,
        reorderPoint: data.reorderPoint ? new Prisma.Decimal(data.reorderPoint) : null,
        productionReorderLevel: data.productionReorderLevel ? new Prisma.Decimal(data.productionReorderLevel) : null,
        reorderQty: data.reorderQty ? new Prisma.Decimal(data.reorderQty) : null,
        safetyStock: data.safetyStock ? new Prisma.Decimal(data.safetyStock) : null,
        leadTimeDays: data.leadTimeDays ?? null,
        // ─── Extended metadata ───
        nameEn: data.nameEn?.trim() || null,
        category: data.category?.trim() || null,
        notes: data.notes?.trim() || null,
        defaultSupplierId: data.defaultSupplierId || null,
        bagWeightKg: data.bagWeightKg ? new Prisma.Decimal(data.bagWeightKg) : null,
        gramsPerUnit: data.gramsPerUnit ? new Prisma.Decimal(data.gramsPerUnit) : null,
        active: data.active === undefined ? true : Boolean(data.active),
      },
    });
  }

  async updateItem(tenantId: string, id: string, data: any) {
    await this.getItem(tenantId, id);
    return this.prisma.item.update({
      where: { id },
      data: {
        name: data.name,
        barcode: data.barcode,
        unit: data.unit,
        netWeightGrams: data.netWeightGrams,
        packagingFormat: data.packagingFormat,
        packsPerCarton: data.packsPerCarton,
        shelfLifeDays: data.shelfLifeDays,
        reorderLevel: data.reorderLevel ? new Prisma.Decimal(data.reorderLevel) : null,
        costPrice: data.costPrice ? new Prisma.Decimal(data.costPrice) : null,
        sellPrice: data.sellPrice ? new Prisma.Decimal(data.sellPrice) : null,
      },
    });
  }

  /** تحديث إعدادات المخزون فقط (min/max/reorder/safety/leadTime) — قابل لاستدعاء منفصل */
  async updateItemSettings(tenantId: string, id: string, data: any) {
    await this.getItem(tenantId, id);
    const dec = (v: any) =>
      v === undefined ? undefined
      : v === null || v === '' ? null
      : new Prisma.Decimal(v);
    return this.prisma.item.update({
      where: { id },
      data: {
        minStock: dec(data.minStock),
        maxStock: dec(data.maxStock),
        reorderPoint: dec(data.reorderPoint),
        productionReorderLevel: dec(data.productionReorderLevel),
        reorderQty: dec(data.reorderQty),
        safetyStock: dec(data.safetyStock),
        leadTimeDays: data.leadTimeDays !== undefined
          ? (data.leadTimeDays === null || data.leadTimeDays === '' ? null : Number(data.leadTimeDays))
          : undefined,
      },
    });
  }

  async deleteItem(tenantId: string, id: string) {
    await this.getItem(tenantId, id);
    await this.prisma.item.update({
      where: { id },
      data: { active: false },
    });
    return { ok: true };
  }

  // ─── Warehouses ──────────────────────────────────
  async listWarehouses(tenantId: string) {
    // المصنع يعمل بمخزن واحد فقط — نضمن وجود «المخزن الرئيسي» ثم نُرجعه.
    await this.resolveMainWarehouse(tenantId);
    return this.prisma.warehouse.findMany({
      where: { tenantId, active: true },
      orderBy: { name: 'asc' },
    });
  }

  async createWarehouse(tenantId: string, data: any) {
    return this.prisma.warehouse.create({
      data: {
        tenantId,
        code: data.code,
        name: data.name,
        type: data.type ?? 'GENERAL',
      },
    });
  }

  /**
   * ─── Resolve MAIN warehouse ─────────────────────────
   * المصنع يستخدم مخزناً واحداً باسم "المخزن الرئيسي" (code=MAIN).
   * إذا لم يكن موجوداً نُنشئه تلقائياً. تُستخدم هذه الدالة داخل receive
   * وadjust عند عدم تمرير warehouseId لكي يعمل النظام بمخزن واحد بشكل شفاف.
   */
  async resolveMainWarehouse(tenantId: string) {
    // 1) ابحث عن MAIN
    let wh = await this.prisma.warehouse.findFirst({
      where: { tenantId, code: 'MAIN' },
    });
    if (wh) return wh;
    // 2) fallback: خذ أول مخزن موجود واعتبره الرئيسي
    wh = await this.prisma.warehouse.findFirst({
      where: { tenantId, active: true },
      orderBy: { createdAt: 'asc' },
    });
    if (wh) return wh;
    // 3) لا يوجد أي مخزن — أنشئ MAIN
    return this.prisma.warehouse.create({
      data: {
        tenantId,
        code: 'MAIN',
        name: 'المخزن الرئيسي',
        type: 'GENERAL',
      },
    });
  }

  // ─── Stock Movements ─────────────────────────────
  async createMovement(tenantId: string, userId: string, data: any) {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.item.findFirst({ where: { id: data.itemId, tenantId } });
      if (!item) throw new NotFoundException('الصنف غير موجود');

      const movement = await tx.stockMovement.create({
        data: {
          tenantId,
          type: data.type,
          itemId: data.itemId,
          batchId: data.batchId,
          fromWarehouseId: data.fromWarehouseId,
          toWarehouseId: data.toWarehouseId,
          quantity: new Prisma.Decimal(data.quantity),
          reasonCode: data.reasonCode,
          notes: data.notes,
          performedById: userId,
        },
      });

      // Update stock levels
      if (data.type === 'IN' || data.type === 'RETURN') {
        if (!data.toWarehouseId) throw new BadRequestException('toWarehouseId مطلوب');
        await this.upsertStockLevel(tx, tenantId, data.itemId, data.toWarehouseId, data.batchId, +data.quantity);
      } else if (data.type === 'OUT' || data.type === 'WASTE') {
        if (!data.fromWarehouseId) throw new BadRequestException('fromWarehouseId مطلوب');
        await this.upsertStockLevel(tx, tenantId, data.itemId, data.fromWarehouseId, data.batchId, -data.quantity);
      } else if (data.type === 'TRANSFER') {
        if (!data.fromWarehouseId || !data.toWarehouseId)
          throw new BadRequestException('fromWarehouseId و toWarehouseId مطلوبان');
        await this.upsertStockLevel(tx, tenantId, data.itemId, data.fromWarehouseId, data.batchId, -data.quantity);
        await this.upsertStockLevel(tx, tenantId, data.itemId, data.toWarehouseId, data.batchId, +data.quantity);
      } else if (data.type === 'ADJUSTMENT') {
        const wh = data.toWarehouseId || data.fromWarehouseId;
        if (!wh) throw new BadRequestException('warehouseId مطلوب');
        await this.upsertStockLevel(tx, tenantId, data.itemId, wh, data.batchId, +data.quantity);
      }

      return movement;
    });
  }

  private async upsertStockLevel(
    tx: any,
    tenantId: string,
    itemId: string,
    warehouseId: string,
    batchId: string | null | undefined,
    delta: number,
  ) {
    const existing = await tx.stockLevel.findFirst({
      where: { itemId, warehouseId, batchId: batchId ?? null },
    });

    if (existing) {
      const newQty = Number(existing.quantity) + delta;
      if (newQty < 0) {
        throw new BadRequestException('المخزون لا يكفي');
      }
      return tx.stockLevel.update({
        where: { id: existing.id },
        data: { quantity: new Prisma.Decimal(newQty) },
      });
    } else {
      if (delta < 0) {
        throw new BadRequestException('لا يمكن الإخراج من مخزون فارغ');
      }
      return tx.stockLevel.create({
        data: {
          tenantId,
          itemId,
          warehouseId,
          batchId,
          quantity: new Prisma.Decimal(delta),
        },
      });
    }
  }

  async listMovements(
    tenantId: string,
    opts: { limit?: number; from?: string; to?: string; itemId?: string; type?: string } = {},
  ) {
    const where: any = { tenantId };
    if (opts.itemId) where.itemId = opts.itemId;
    if (opts.type) where.type = opts.type;
    if (opts.from || opts.to) {
      where.performedAt = {};
      if (opts.from) where.performedAt.gte = new Date(opts.from);
      if (opts.to) {
        const t = new Date(opts.to);
        t.setDate(t.getDate() + 1);
        where.performedAt.lt = t;
      }
    }
    return this.prisma.stockMovement.findMany({
      where,
      include: {
        item: true,
        fromWarehouse: true,
        toWarehouse: true,
      },
      orderBy: { performedAt: 'desc' },
      take: opts.limit ?? 500,
    });
  }

  // ─── Snapshot (backward-compat) ──────────────────
  async getSnapshot(tenantId: string) {
    const items = await this.listItems(tenantId);
    const lowStock = items.filter((i) => i.isLow).length;

    const totalsByType: Record<string, number> = {};
    for (const item of items) {
      const type = item.type;
      totalsByType[type] = (totalsByType[type] ?? 0) + item.totalStock;
    }

    const expiringBatches = await this.prisma.batch.count({
      where: {
        tenantId,
        expiryDate: {
          gte: new Date(),
          lte: new Date(Date.now() + 7 * 86400000),
        },
      },
    });

    return {
      itemsCount: items.length,
      lowStockCount: lowStock,
      expiringBatches,
      totalsByType,
    };
  }

  // ─── Enterprise Dashboard ────────────────────────
  /**
   * لوحة تحكم مخزون كاملة: قيمة، تنبيهات، توزيعات، آخر النشاطات.
   * ملاحظة: القيمة المالية = totalStock × avgCost (وإلا costPrice).
   */
  async getDashboard(tenantId: string) {
    const round = (n: number, d = 2) =>
      Math.round(n * Math.pow(10, d)) / Math.pow(10, d);

    const [items, expiringBatches, recentReceipts, recentAdjustments, movements] =
      await Promise.all([
        this.prisma.item.findMany({
          where: { tenantId, active: true },
          include: { stockLevels: true },
        }),
        this.prisma.batch.findMany({
          where: {
            tenantId,
            expiryDate: {
              gte: new Date(),
              lte: new Date(Date.now() + 30 * 86400000),
            },
          },
          include: { item: true },
          orderBy: { expiryDate: 'asc' },
          take: 20,
        }),
        this.prisma.stockReceipt.findMany({
          where: { tenantId },
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: { item: true, supplier: true },
        }),
        this.prisma.stockAdjustment.findMany({
          where: { tenantId },
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: { item: true },
        }),
        this.prisma.stockMovement.findMany({
          where: {
            tenantId,
            performedAt: { gte: new Date(Date.now() - 30 * 86400000) },
          },
          orderBy: { performedAt: 'desc' },
        }),
      ]);

    // إحصائيات الأصناف
    let totalValue = 0;
    let totalStockQty = 0;
    let outOfStock = 0;
    let lowStock = 0;
    let critical = 0;
    const valueByType: Record<string, number> = {};
    const qtyByType: Record<string, number> = {};
    const lowStockItems: any[] = [];
    const recentItems: any[] = [];

    for (const it of items) {
      const stock = it.stockLevels.reduce((s, sl) => s + Number(sl.quantity), 0);
      totalStockQty += stock;
      const cost = Number(it.avgCost ?? it.costPrice ?? 0);
      const value = stock * cost;
      totalValue += value;
      valueByType[it.type] = (valueByType[it.type] ?? 0) + value;
      qtyByType[it.type] = (qtyByType[it.type] ?? 0) + stock;

      const minS = it.minStock != null ? Number(it.minStock) : null;
      const reorderP = it.reorderPoint != null ? Number(it.reorderPoint) : (it.reorderLevel != null ? Number(it.reorderLevel) : null);
      const safety = it.safetyStock != null ? Number(it.safetyStock) : null;

      const isOut = stock <= 0;
      const isCritical = safety != null && stock < safety && !isOut;
      const isLow = (reorderP != null && stock < reorderP) || (minS != null && stock < minS);

      if (isOut) outOfStock++;
      else if (isCritical) critical++;
      else if (isLow) lowStock++;

      if ((isLow || isCritical || isOut) && lowStockItems.length < 20) {
        lowStockItems.push({
          id: it.id,
          sku: it.sku,
          name: it.name,
          type: it.type,
          unit: it.unit,
          stock: round(stock),
          minStock: minS,
          reorderPoint: reorderP,
          safetyStock: safety,
          status: isOut ? 'OUT' : isCritical ? 'CRITICAL' : 'LOW',
        });
      }
    }

    // آخر المضافة (بحسب createdAt)
    const sortedByCreated = [...items].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
    for (const it of sortedByCreated.slice(0, 8)) {
      recentItems.push({
        id: it.id,
        sku: it.sku,
        name: it.name,
        type: it.type,
        createdAt: it.createdAt,
      });
    }

    // آخر المعدَّلة
    const recentModified = [...items]
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, 8)
      .map((it) => ({
        id: it.id,
        sku: it.sku,
        name: it.name,
        type: it.type,
        updatedAt: it.updatedAt,
      }));

    // حركة يومية آخر 14 يوم (IN vs OUT)
    const trend: { date: string; in: number; out: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const day = new Date();
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() - i);
      const next = new Date(day.getTime() + 86400000);
      const dayMoves = movements.filter(
        (m) => m.performedAt >= day && m.performedAt < next,
      );
      const inQty = dayMoves
        .filter((m) => m.type === 'IN' || m.type === 'RETURN')
        .reduce((s, m) => s + Number(m.quantity), 0);
      const outQty = dayMoves
        .filter((m) => m.type === 'OUT' || m.type === 'WASTE')
        .reduce((s, m) => s + Number(m.quantity), 0);
      trend.push({
        date: day.toISOString().slice(0, 10),
        in: round(inQty),
        out: round(outQty),
      });
    }

    // أكثر الأصناف حركة (خروج) آخر 30 يوم
    const outByItem: Record<string, number> = {};
    for (const m of movements) {
      if (m.type === 'OUT' || m.type === 'WASTE') {
        outByItem[m.itemId] = (outByItem[m.itemId] ?? 0) + Number(m.quantity);
      }
    }
    const topMoving = Object.entries(outByItem)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([itemId, qty]) => {
        const it = items.find((x) => x.id === itemId);
        return {
          id: itemId,
          name: it?.name ?? '',
          sku: it?.sku ?? '',
          qty: round(qty as number),
        };
      });

    // أقل الأصناف حركة (لم يتحرك في آخر 30 يوم)
    const deadStock = items
      .filter((it) => !outByItem[it.id])
      .slice(0, 10)
      .map((it) => ({
        id: it.id,
        sku: it.sku,
        name: it.name,
        type: it.type,
      }));

    return {
      kpi: {
        totalValue: round(totalValue),
        itemsCount: items.length,
        totalStockQty: round(totalStockQty),
        outOfStock,
        lowStock,
        critical,
        expiringSoonCount: expiringBatches.length,
      },
      valueByType: Object.fromEntries(
        Object.entries(valueByType).map(([k, v]) => [k, round(v as number)]),
      ),
      qtyByType: Object.fromEntries(
        Object.entries(qtyByType).map(([k, v]) => [k, round(v as number)]),
      ),
      lowStockItems,
      recentItems,
      recentModified,
      recentReceipts: recentReceipts.map((r) => ({
        id: r.id,
        item: r.item?.name,
        source: r.source,
        supplier: r.supplier?.name ?? null,
        quantity: Number(r.quantity),
        unitCost: r.unitCost != null ? Number(r.unitCost) : null,
        createdAt: r.createdAt,
      })),
      recentAdjustments: recentAdjustments.map((a) => ({
        id: a.id,
        item: a.item?.name,
        type: a.type,
        quantity: Number(a.quantity),
        reason: a.reason,
        createdAt: a.createdAt,
      })),
      trend,
      topMoving,
      deadStock,
      expiring: expiringBatches.map((b) => ({
        id: b.id,
        code: b.code,
        item: b.item?.name,
        expiryDate: b.expiryDate,
      })),
    };
  }

  /** قائمة تنبيهات المخزون (منخفض/حرج/منتهي) */
  async getAlerts(tenantId: string) {
    const dash = await this.getDashboard(tenantId);
    return {
      lowStock: dash.lowStockItems,
      expiring: dash.expiring,
      kpi: dash.kpi,
    };
  }

  // ─── Stock Adjustment (تعديل مخزون يدوي) ─────────
  /**
   * تعديل مخزون بأنواعه:
   *   ADD | DEDUCT | CORRECTION | COUNT | DAMAGE | LOSS | EXPIRY | SUPPLIER_RETURN
   * - COUNT: يعيّن الكمية إلى قيمة مطلقة (delta = target - current)
   * - كل التعديلات تُنشئ سطراً في StockMovement + StockAdjustment (audit)
   */
  async adjustStock(tenantId: string, userId: string, data: any) {
    if (!data.itemId) throw new BadRequestException('الصنف مطلوب');
    // ─── مخزن واحد فقط: نستخدم "المخزن الرئيسي" تلقائياً ─
    if (!data.warehouseId) {
      const main = await this.resolveMainWarehouse(tenantId);
      data.warehouseId = main.id;
    }
    if (!data.reason?.trim()) throw new BadRequestException('السبب مطلوب');

    const type = String(data.type || 'ADD').toUpperCase();
    const qty = Number(data.quantity);
    if (type !== 'COUNT' && !(qty > 0)) {
      throw new BadRequestException('الكمية يجب أن تكون أكبر من صفر');
    }

    return this.prisma.$transaction(async (tx) => {
      const item = await tx.item.findFirst({ where: { id: data.itemId, tenantId } });
      if (!item) throw new NotFoundException('الصنف غير موجود');

      const current = await tx.stockLevel.findFirst({
        where: { itemId: data.itemId, warehouseId: data.warehouseId, batchId: null },
      });
      const before = current ? Number(current.quantity) : 0;

      let delta = 0;
      let moveType = 'ADJUSTMENT';
      switch (type) {
        case 'ADD':
          delta = qty;
          moveType = 'IN';
          break;
        case 'DEDUCT':
          delta = -qty;
          moveType = 'OUT';
          break;
        case 'CORRECTION':
          // تصحيح دلتا مباشر (قد يكون سالب أو موجب) — نمرره كما هو
          delta = Number(data.quantity);
          moveType = 'ADJUSTMENT';
          break;
        case 'COUNT':
          // جرد — قيمة مطلقة
          delta = qty - before;
          moveType = 'ADJUSTMENT';
          break;
        case 'DAMAGE':
        case 'LOSS':
        case 'EXPIRY':
          delta = -qty;
          moveType = 'WASTE';
          break;
        case 'SUPPLIER_RETURN':
          delta = -qty;
          moveType = 'OUT';
          break;
        default:
          throw new BadRequestException(`نوع تعديل غير مدعوم: ${type}`);
      }

      if (before + delta < 0) {
        throw new BadRequestException(`المخزون لا يكفي (المتاح: ${before})`);
      }

      // حدّث الرصيد
      await this.upsertStockLevel(tx, tenantId, data.itemId, data.warehouseId, null, delta);
      const after = before + delta;

      // سجّل StockMovement
      await tx.stockMovement.create({
        data: {
          tenantId,
          type: moveType as any,
          itemId: data.itemId,
          fromWarehouseId: delta < 0 ? data.warehouseId : null,
          toWarehouseId: delta > 0 ? data.warehouseId : null,
          quantity: new Prisma.Decimal(Math.abs(delta)),
          reasonCode: type,
          refType: 'StockAdjustment',
          notes: data.reason + (data.notes ? ` — ${data.notes}` : ''),
          performedById: userId,
        },
      });

      // سجّل StockAdjustment (Audit كامل)
      const adj = await tx.stockAdjustment.create({
        data: {
          tenantId,
          itemId: data.itemId,
          warehouseId: data.warehouseId,
          type,
          quantity: new Prisma.Decimal(delta),
          quantityBefore: new Prisma.Decimal(before),
          quantityAfter: new Prisma.Decimal(after),
          reason: data.reason,
          notes: data.notes ?? null,
          imageUrl: data.imageUrl ?? null,
          status: 'APPROVED',
          performedById: userId,
        },
      });

      return { ok: true, adjustmentId: adj.id, before, after, delta };
    });
  }

  // ─── Stock Receipt (استلام مخزون) ───────────────
  /**
   * استلام مخزون جديد بمصادر مختلفة:
   *   SUPPLIER | MANUAL | TRANSFER_IN | CUSTOMER_RETURN | PRODUCTION
   * - يُنشئ Batch إن وُجد batchNumber
   * - يحدّث StockLevel + StockMovement + StockReceipt
   * - يحدّث بيانات الصنف: lastPurchasePrice, avgCost (weighted avg), lastPurchaseAt
   */
  async receiveStock(tenantId: string, userId: string, data: any) {
    if (!data.itemId) throw new BadRequestException('الصنف مطلوب');
    // ─── مخزن واحد فقط: نستخدم "المخزن الرئيسي" تلقائياً ─
    if (!data.warehouseId) {
      const main = await this.resolveMainWarehouse(tenantId);
      data.warehouseId = main.id;
    }
    const qty = Number(data.quantity);
    if (!(qty > 0)) throw new BadRequestException('الكمية يجب أن تكون أكبر من صفر');
    const source = String(data.source || 'MANUAL').toUpperCase();

    return this.prisma.$transaction(async (tx) => {
      const item = await tx.item.findFirst({ where: { id: data.itemId, tenantId } });
      if (!item) throw new NotFoundException('الصنف غير موجود');

      // أنشئ الـ Batch إن وُجد رقم
      let batchId: string | null = null;
      if (data.batchNumber?.trim()) {
        // تجنّب التكرار
        const existingBatch = await tx.batch.findFirst({
          where: { tenantId, code: data.batchNumber, itemId: data.itemId },
        });
        if (existingBatch) {
          batchId = existingBatch.id;
        } else {
          const batch = await tx.batch.create({
            data: {
              tenantId,
              itemId: data.itemId,
              code: data.batchNumber,
              productionDate: data.productionDate ? new Date(data.productionDate) : null,
              expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
            },
          });
          batchId = batch.id;
        }
      }

      // حدّث المخزون
      await this.upsertStockLevel(tx, tenantId, data.itemId, data.warehouseId, batchId, qty);

      // StockMovement
      await tx.stockMovement.create({
        data: {
          tenantId,
          type: 'IN',
          itemId: data.itemId,
          batchId,
          toWarehouseId: data.warehouseId,
          quantity: new Prisma.Decimal(qty),
          reasonCode: `RECEIVE_${source}`,
          refType: 'StockReceipt',
          notes: data.notes ?? `استلام مصدر ${source}`,
          performedById: userId,
        },
      });

      // StockReceipt (سجل الاستلام الكامل)
      const receipt = await tx.stockReceipt.create({
        data: {
          tenantId,
          itemId: data.itemId,
          warehouseId: data.warehouseId,
          source,
          quantity: new Prisma.Decimal(qty),
          unitCost: data.unitCost ? new Prisma.Decimal(data.unitCost) : null,
          supplierId: data.supplierId ?? null,
          invoiceNumber: data.invoiceNumber ?? null,
          purchaseOrderNumber: data.purchaseOrderNumber ?? null,
          batchNumber: data.batchNumber ?? null,
          serialNumber: data.serialNumber ?? null,
          productionDate: data.productionDate ? new Date(data.productionDate) : null,
          expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
          notes: data.notes ?? null,
          performedById: userId,
        },
      });

      // ─── FIFO: أنشئ دفعة شراء (Purchase Batch) لكل استلام ─
      // كل استلام يخلق سطراً مستقلاً في PurchaseBatch مع remaining = quantity.
      // العمليات المستقبلية ستستهلك FIFO من هذا السطر.
      if (qty > 0) {
        await tx.purchaseBatch.create({
          data: {
            tenantId,
            itemId: data.itemId,
            batchNumber: data.batchNumber ?? data.invoiceNumber ?? null,
            purchaseDate: data.productionDate ? new Date(data.productionDate) : new Date(),
            quantity: new Prisma.Decimal(qty),
            remaining: new Prisma.Decimal(qty),
            unitCost: new Prisma.Decimal(data.unitCost ? Number(data.unitCost) : 0),
            sourceType: source,
            sourceRefId: receipt.id,
            supplierId: data.supplierId ?? null,
            createdById: userId,
          },
        });
      }

      // حدّث بيانات الصنف (متوسط تكلفة مرجّح، آخر شراء)
      if (data.unitCost && source === 'SUPPLIER') {
        const currentAvg = item.avgCost ? Number(item.avgCost) : Number(item.costPrice ?? 0);
        const currentStock = await this.getCurrentStock(tx, data.itemId);
        const newTotal = currentStock + qty;
        const newAvg = newTotal > 0
          ? (currentAvg * currentStock + Number(data.unitCost) * qty) / newTotal
          : Number(data.unitCost);
        await tx.item.update({
          where: { id: data.itemId },
          data: {
            lastPurchasePrice: new Prisma.Decimal(data.unitCost),
            avgCost: new Prisma.Decimal(newAvg),
            lastPurchaseAt: new Date(),
          },
        });
      }

      return { ok: true, receiptId: receipt.id, batchId };
    });
  }

  private async getCurrentStock(tx: any, itemId: string): Promise<number> {
    const levels = await tx.stockLevel.findMany({ where: { itemId } });
    return levels.reduce((s: number, sl: any) => s + Number(sl.quantity), 0);
  }

  // ─── Item history (سجل حركة المادة) ─────────────
  async getItemMovements(tenantId: string, itemId: string, limit = 100) {
    const [movements, adjustments, receipts] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where: { tenantId, itemId },
        include: { fromWarehouse: true, toWarehouse: true, batch: true },
        orderBy: { performedAt: 'desc' },
        take: limit,
      }),
      this.prisma.stockAdjustment.findMany({
        where: { tenantId, itemId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.stockReceipt.findMany({
        where: { tenantId, itemId },
        include: { supplier: true },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
    ]);
    return { movements, adjustments, receipts };
  }

  // ─── Item analytics ──────────────────────────────
  async getItemAnalytics(tenantId: string, itemId: string) {
    const item = await this.prisma.item.findFirst({
      where: { id: itemId, tenantId },
      include: {
        stockLevels: { include: { warehouse: true } },
      },
    });
    if (!item) throw new NotFoundException('الصنف غير موجود');

    const totalStock = item.stockLevels.reduce((s, sl) => s + Number(sl.quantity), 0);
    const cost = Number(item.avgCost ?? item.costPrice ?? 0);
    const value = totalStock * cost;

    const minS = item.minStock != null ? Number(item.minStock) : null;
    const reorderP = item.reorderPoint != null ? Number(item.reorderPoint) : (item.reorderLevel != null ? Number(item.reorderLevel) : null);
    const safety = item.safetyStock != null ? Number(item.safetyStock) : null;
    const status = totalStock <= 0 ? 'OUT_OF_STOCK'
      : safety != null && totalStock < safety ? 'CRITICAL'
      : (reorderP != null && totalStock < reorderP) || (minS != null && totalStock < minS) ? 'LOW'
      : 'OK';

    return {
      item,
      totalStock,
      totalValue: Math.round(value * 100) / 100,
      status,
      stockByWarehouse: item.stockLevels.map((sl) => ({
        warehouseId: sl.warehouseId,
        warehouseName: sl.warehouse?.name,
        quantity: Number(sl.quantity),
      })),
    };
  }

  // ─── Suppliers ───────────────────────────────────
  async listSuppliers(tenantId: string) {
    return this.prisma.supplier.findMany({
      where: { tenantId, active: true },
      orderBy: { name: 'asc' },
    });
  }

  async createSupplier(tenantId: string, data: any) {
    if (!data.name?.trim()) throw new BadRequestException('اسم المورد مطلوب');
    return this.prisma.supplier.create({
      data: {
        tenantId,
        code: data.code ?? null,
        name: data.name.trim(),
        phone: data.phone ?? null,
        email: data.email ?? null,
        address: data.address ?? null,
        notes: data.notes ?? null,
      },
    });
  }

  async updateSupplier(tenantId: string, id: string, data: any) {
    const s = await this.prisma.supplier.findFirst({ where: { id, tenantId } });
    if (!s) throw new NotFoundException('المورد غير موجود');
    return this.prisma.supplier.update({
      where: { id },
      data: {
        code: data.code ?? s.code,
        name: data.name?.trim() ?? s.name,
        phone: data.phone ?? s.phone,
        email: data.email ?? s.email,
        address: data.address ?? s.address,
        notes: data.notes ?? s.notes,
      },
    });
  }

  async deleteSupplier(tenantId: string, id: string) {
    const s = await this.prisma.supplier.findFirst({ where: { id, tenantId } });
    if (!s) throw new NotFoundException();
    await this.prisma.supplier.update({ where: { id }, data: { active: false } });
    return { ok: true };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ─── تحويل بين المستودعات (بموافقة) ─────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════
  private async nextNumber(tx: any, tenantId: string, prefix: string): Promise<string> {
    const year = new Date().getFullYear();
    const like = `${prefix}-${year}-`;
    const model = prefix === 'TRF' ? tx.stockTransfer : tx.inventoryCount;
    const count = await model.count({
      where: { tenantId, number: { startsWith: like } },
    });
    return `${prefix}-${year}-${String(count + 1).padStart(4, '0')}`;
  }

  async createTransfer(tenantId: string, userId: string, data: any) {
    if (!data.itemId) throw new BadRequestException('الصنف مطلوب');
    if (!data.fromWarehouseId || !data.toWarehouseId)
      throw new BadRequestException('المستودع المُرسِل والمستقبل مطلوبان');
    if (data.fromWarehouseId === data.toWarehouseId)
      throw new BadRequestException('لا يمكن التحويل لنفس المستودع');
    const qty = Number(data.quantity);
    if (!(qty > 0)) throw new BadRequestException('الكمية غير صحيحة');

    return this.prisma.$transaction(async (tx) => {
      // فحص الرصيد
      const level = await tx.stockLevel.findFirst({
        where: { itemId: data.itemId, warehouseId: data.fromWarehouseId, batchId: null },
      });
      if (!level || Number(level.quantity) < qty) {
        throw new BadRequestException(
          `الرصيد لا يكفي (المتاح: ${level ? Number(level.quantity) : 0})`,
        );
      }
      const number = await this.nextNumber(tx, tenantId, 'TRF');
      return tx.stockTransfer.create({
        data: {
          tenantId,
          number,
          itemId: data.itemId,
          fromWarehouseId: data.fromWarehouseId,
          toWarehouseId: data.toWarehouseId,
          quantity: new Prisma.Decimal(qty),
          status: 'PENDING',
          notes: data.notes ?? null,
          requestedById: userId,
        },
      });
    });
  }

  async listTransfers(tenantId: string, opts: { status?: string } = {}) {
    return this.prisma.stockTransfer.findMany({
      where: {
        tenantId,
        ...(opts.status ? { status: opts.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async approveTransfer(tenantId: string, userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const trf = await tx.stockTransfer.findFirst({ where: { id, tenantId } });
      if (!trf) throw new NotFoundException('التحويل غير موجود');
      if (trf.status !== 'PENDING')
        throw new BadRequestException(`لا يمكن الاعتماد — الحالة الحالية: ${trf.status}`);

      const qty = Number(trf.quantity);
      // خصم من المُرسِل
      await this.upsertStockLevel(tx, tenantId, trf.itemId, trf.fromWarehouseId, null, -qty);
      // إضافة للمستقبل
      await this.upsertStockLevel(tx, tenantId, trf.itemId, trf.toWarehouseId, null, +qty);

      // سجل حركة نقل
      await tx.stockMovement.create({
        data: {
          tenantId,
          type: 'TRANSFER',
          itemId: trf.itemId,
          fromWarehouseId: trf.fromWarehouseId,
          toWarehouseId: trf.toWarehouseId,
          quantity: trf.quantity,
          reasonCode: 'TRANSFER_APPROVED',
          refType: 'StockTransfer',
          refId: trf.id,
          notes: `تحويل ${trf.number}${trf.notes ? ' — ' + trf.notes : ''}`,
          performedById: userId,
        },
      });

      return tx.stockTransfer.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          approvedById: userId,
          approvedAt: new Date(),
          executedAt: new Date(),
        },
      });
    });
  }

  async rejectTransfer(tenantId: string, userId: string, id: string, reason?: string) {
    const trf = await this.prisma.stockTransfer.findFirst({ where: { id, tenantId } });
    if (!trf) throw new NotFoundException('التحويل غير موجود');
    if (trf.status !== 'PENDING')
      throw new BadRequestException(`لا يمكن الرفض — الحالة الحالية: ${trf.status}`);
    return this.prisma.stockTransfer.update({
      where: { id },
      data: {
        status: 'REJECTED',
        approvedById: userId,
        approvedAt: new Date(),
        rejectedReason: reason ?? 'رفض بدون سبب',
      },
    });
  }

  async cancelTransfer(tenantId: string, id: string) {
    const trf = await this.prisma.stockTransfer.findFirst({ where: { id, tenantId } });
    if (!trf) throw new NotFoundException();
    if (trf.status === 'COMPLETED')
      throw new BadRequestException('لا يمكن إلغاء تحويل مُنفَّذ');
    return this.prisma.stockTransfer.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ─── الجرد (Inventory Count) ────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════
  /**
   * ينشئ جلسة جرد جديدة ويولّد سطراً لكل صنف×مستودع بكميته الحالية (expected)
   * إن مُرِّر warehouseId → الجرد لهذا المستودع فقط.
   */
  async createCount(tenantId: string, userId: string, data: any) {
    return this.prisma.$transaction(async (tx) => {
      const number = await this.nextNumber(tx, tenantId, 'CNT');
      const count = await tx.inventoryCount.create({
        data: {
          tenantId,
          number,
          warehouseId: data.warehouseId ?? null,
          scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
          frozen: !!data.frozen,
          notes: data.notes ?? null,
          status: 'DRAFT',
          createdById: userId,
        },
      });

      // ولّد سطر لكل item×warehouse يحتوي كمية موجودة (expected)
      const levels = await tx.stockLevel.findMany({
        where: {
          tenantId,
          batchId: null,
          ...(data.warehouseId ? { warehouseId: data.warehouseId } : {}),
        },
      });
      if (levels.length > 0) {
        await tx.inventoryCountLine.createMany({
          data: levels.map((l: any) => ({
            tenantId,
            countId: count.id,
            itemId: l.itemId,
            warehouseId: l.warehouseId,
            expectedQty: l.quantity,
          })),
        });
      }
      return count;
    });
  }

  async listCounts(tenantId: string, opts: { status?: string } = {}) {
    return this.prisma.inventoryCount.findMany({
      where: {
        tenantId,
        ...(opts.status ? { status: opts.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async getCount(tenantId: string, id: string) {
    const c = await this.prisma.inventoryCount.findFirst({
      where: { id, tenantId },
      include: { lines: { orderBy: { itemId: 'asc' } } },
    });
    if (!c) throw new NotFoundException();

    // Enrich lines with item + warehouse names
    const itemIds: string[] = Array.from(new Set(c.lines.map((l: any) => String(l.itemId))));
    const whIds: string[] = Array.from(new Set(c.lines.map((l: any) => String(l.warehouseId))));
    const [items, whs] = await Promise.all([
      this.prisma.item.findMany({ where: { id: { in: itemIds } } }),
      this.prisma.warehouse.findMany({ where: { id: { in: whIds } } }),
    ]);
    const iMap = new Map(items.map((i: any) => [i.id, i]));
    const wMap = new Map(whs.map((w: any) => [w.id, w]));

    return {
      ...c,
      lines: c.lines.map((l: any) => ({
        ...l,
        item: iMap.get(l.itemId),
        warehouse: wMap.get(l.warehouseId),
      })),
    };
  }

  async updateCountLine(
    tenantId: string,
    lineId: string,
    userId: string,
    data: { actualQty?: number; notes?: string },
  ) {
    const line = await this.prisma.inventoryCountLine.findFirst({
      where: { id: lineId, tenantId },
    });
    if (!line) throw new NotFoundException('سطر الجرد غير موجود');

    const actualQty = data.actualQty !== undefined ? Number(data.actualQty) : null;
    const variance = actualQty != null ? actualQty - Number(line.expectedQty) : null;

    return this.prisma.inventoryCountLine.update({
      where: { id: lineId },
      data: {
        actualQty: actualQty != null ? new Prisma.Decimal(actualQty) : null,
        variance: variance != null ? new Prisma.Decimal(variance) : null,
        notes: data.notes ?? line.notes,
        countedById: userId,
        countedAt: new Date(),
      },
    });
  }

  /**
   * إغلاق الجرد: يطبّق الفروقات على المخزون كـ StockAdjustment type=COUNT
   * ويحدّد حالة الجرد كـ APPROVED (مُعتَمَد + طُبِّق).
   */
  async closeCount(tenantId: string, userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.inventoryCount.findFirst({
        where: { id, tenantId },
        include: { lines: true },
      });
      if (!c) throw new NotFoundException();
      if (c.status === 'APPROVED' || c.status === 'CANCELLED') {
        throw new BadRequestException('تعذّر — الجرد مغلق مسبقاً');
      }

      let applied = 0;
      for (const line of c.lines as any[]) {
        if (line.actualQty == null) continue; // لم يُجرَد
        const expected = Number(line.expectedQty);
        const actual = Number(line.actualQty);
        const delta = actual - expected;
        if (Math.abs(delta) < 0.0001) continue; // لا فرق

        // حدّث الرصيد
        await this.upsertStockLevel(tx, tenantId, line.itemId, line.warehouseId, null, delta);

        // StockMovement
        await tx.stockMovement.create({
          data: {
            tenantId,
            type: 'ADJUSTMENT',
            itemId: line.itemId,
            fromWarehouseId: delta < 0 ? line.warehouseId : null,
            toWarehouseId: delta > 0 ? line.warehouseId : null,
            quantity: new Prisma.Decimal(Math.abs(delta)),
            reasonCode: 'COUNT_VARIANCE',
            refType: 'InventoryCount',
            refId: c.id,
            notes: `فرق جرد ${c.number}${line.notes ? ' — ' + line.notes : ''}`,
            performedById: userId,
          },
        });

        // StockAdjustment (audit)
        await tx.stockAdjustment.create({
          data: {
            tenantId,
            itemId: line.itemId,
            warehouseId: line.warehouseId,
            type: 'COUNT',
            quantity: new Prisma.Decimal(delta),
            quantityBefore: new Prisma.Decimal(expected),
            quantityAfter: new Prisma.Decimal(actual),
            reason: `جرد ${c.number}`,
            notes: line.notes ?? null,
            status: 'APPROVED',
            refType: 'InventoryCount',
            refId: c.id,
            performedById: userId,
          },
        });
        applied++;
      }

      const updated = await tx.inventoryCount.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approvedById: userId,
          approvedAt: new Date(),
        },
      });
      return { ...updated, adjustmentsApplied: applied };
    });
  }

  async cancelCount(tenantId: string, id: string) {
    const c = await this.prisma.inventoryCount.findFirst({ where: { id, tenantId } });
    if (!c) throw new NotFoundException();
    if (c.status === 'APPROVED')
      throw new BadRequestException('لا يمكن إلغاء جرد مُعتَمَد');
    return this.prisma.inventoryCount.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ─── CSV Reports ────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════
  private toCsv(rows: any[], headers: { key: string; label: string }[]): string {
    const esc = (v: any) => {
      if (v === null || v === undefined) return '';
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    const head = headers.map((h) => esc(h.label)).join(',');
    const body = rows
      .map((r) => headers.map((h) => esc(r[h.key])).join(','))
      .join('\n');
    // BOM لعرض العربية بشكل صحيح في Excel
    return '﻿' + head + '\n' + body;
  }

  async reportStockValueCsv(tenantId: string): Promise<string> {
    const items = await this.prisma.item.findMany({
      where: { tenantId, active: true },
      include: { stockLevels: true },
      orderBy: { name: 'asc' },
    });
    const rows = items.map((it: any) => {
      const qty = it.stockLevels.reduce((s: number, sl: any) => s + Number(sl.quantity), 0);
      const cost = Number(it.avgCost ?? it.costPrice ?? 0);
      const value = qty * cost;
      return {
        sku: it.sku,
        name: it.name,
        type: it.type,
        unit: it.unit,
        quantity: qty,
        avgCost: cost,
        value: Math.round(value * 100) / 100,
      };
    });
    return this.toCsv(rows, [
      { key: 'sku', label: 'SKU' },
      { key: 'name', label: 'الاسم' },
      { key: 'type', label: 'النوع' },
      { key: 'unit', label: 'الوحدة' },
      { key: 'quantity', label: 'الكمية' },
      { key: 'avgCost', label: 'متوسط التكلفة' },
      { key: 'value', label: 'القيمة' },
    ]);
  }

  async reportMovementCsv(tenantId: string, days = 30): Promise<string> {
    const from = new Date(Date.now() - days * 86400000);
    const movements = await this.prisma.stockMovement.findMany({
      where: { tenantId, performedAt: { gte: from } },
      include: { item: true, fromWarehouse: true, toWarehouse: true },
      orderBy: { performedAt: 'desc' },
    });
    const rows = movements.map((m: any) => ({
      date: new Date(m.performedAt).toISOString().slice(0, 19).replace('T', ' '),
      type: m.type,
      item: m.item?.name,
      sku: m.item?.sku,
      quantity: Number(m.quantity),
      from: m.fromWarehouse?.name ?? '',
      to: m.toWarehouse?.name ?? '',
      reason: m.reasonCode ?? '',
      notes: m.notes ?? '',
    }));
    return this.toCsv(rows, [
      { key: 'date', label: 'التاريخ' },
      { key: 'type', label: 'النوع' },
      { key: 'item', label: 'المادة' },
      { key: 'sku', label: 'SKU' },
      { key: 'quantity', label: 'الكمية' },
      { key: 'from', label: 'من' },
      { key: 'to', label: 'إلى' },
      { key: 'reason', label: 'السبب' },
      { key: 'notes', label: 'ملاحظات' },
    ]);
  }

  async reportLowStockCsv(tenantId: string): Promise<string> {
    const dash = await this.getDashboard(tenantId);
    const rows = dash.lowStockItems.map((it: any) => ({
      sku: it.sku,
      name: it.name,
      type: it.type,
      stock: it.stock,
      minStock: it.minStock ?? '',
      reorderPoint: it.reorderPoint ?? '',
      safetyStock: it.safetyStock ?? '',
      status: it.status,
    }));
    return this.toCsv(rows, [
      { key: 'sku', label: 'SKU' },
      { key: 'name', label: 'الاسم' },
      { key: 'type', label: 'النوع' },
      { key: 'stock', label: 'الكمية' },
      { key: 'minStock', label: 'الحد الأدنى' },
      { key: 'reorderPoint', label: 'نقطة إعادة الطلب' },
      { key: 'safetyStock', label: 'مخزون الأمان' },
      { key: 'status', label: 'الحالة' },
    ]);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ─── Bulk Operations ────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════
  async bulkActivateItems(tenantId: string, ids: string[]) {
    if (!Array.isArray(ids) || ids.length === 0)
      throw new BadRequestException('لا توجد أصناف مختارة');
    const res = await this.prisma.item.updateMany({
      where: { tenantId, id: { in: ids } },
      data: { active: true },
    });
    return { ok: true, updated: res.count };
  }

  async bulkDeactivateItems(tenantId: string, ids: string[]) {
    if (!Array.isArray(ids) || ids.length === 0)
      throw new BadRequestException('لا توجد أصناف مختارة');
    const res = await this.prisma.item.updateMany({
      where: { tenantId, id: { in: ids } },
      data: { active: false },
    });
    return { ok: true, updated: res.count };
  }

  /**
   * استيراد أصناف من CSV/Excel (dry-run اختياري).
   * الحقول المتوقعة: sku, name, type, unit, barcode, costPrice, sellPrice,
   * reorderLevel, minStock, maxStock, reorderPoint, safetyStock, leadTimeDays.
   * - يُنشئ الصنف الجديد أو يحدّث الموجود (upsert by SKU).
   * - يرجع { created, updated, skipped, errors }.
   */
  async importItems(
    tenantId: string,
    rows: any[],
    opts: { dryRun?: boolean } = {},
  ) {
    if (!Array.isArray(rows) || rows.length === 0)
      throw new BadRequestException('لا توجد صفوف');
    const dryRun = !!opts.dryRun;

    const validTypes = new Set(['POWDER_BULK', 'PACKAGING', 'POWDER_RETAIL', 'CONSUMABLE']);
    const results: any = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [] as Array<{ row: number; sku: string; error: string }>,
    };

    const normDecimal = (v: any) =>
      v === '' || v === null || v === undefined ? null : new Prisma.Decimal(Number(v));
    const normInt = (v: any) =>
      v === '' || v === null || v === undefined ? null : Number(v);

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const sku = String(r.sku ?? '').trim();
      const name = String(r.name ?? '').trim();
      const type = String(r.type ?? '').trim().toUpperCase();

      if (!sku) { results.skipped++; results.errors.push({ row: i + 1, sku: '(missing)', error: 'SKU مطلوب' }); continue; }
      if (!name) { results.skipped++; results.errors.push({ row: i + 1, sku, error: 'الاسم مطلوب' }); continue; }
      if (!validTypes.has(type)) {
        results.skipped++;
        results.errors.push({
          row: i + 1, sku,
          error: `النوع غير صحيح (المتاح: POWDER_BULK, PACKAGING, POWDER_RETAIL, CONSUMABLE)`,
        });
        continue;
      }

      if (dryRun) {
        const existing = await this.prisma.item.findUnique({ where: { tenantId_sku: { tenantId, sku } } });
        if (existing) results.updated++;
        else results.created++;
        continue;
      }

      try {
        const data = {
          barcode: r.barcode?.trim() || null,
          name,
          type: type as any,
          unit: r.unit?.trim() || 'PCS',
          costPrice: normDecimal(r.costPrice),
          sellPrice: normDecimal(r.sellPrice),
          reorderLevel: normDecimal(r.reorderLevel),
          minStock: normDecimal(r.minStock),
          maxStock: normDecimal(r.maxStock),
          reorderPoint: normDecimal(r.reorderPoint),
          safetyStock: normDecimal(r.safetyStock),
          leadTimeDays: normInt(r.leadTimeDays),
        };
        const existing = await this.prisma.item.findUnique({
          where: { tenantId_sku: { tenantId, sku } },
        });
        if (existing) {
          await this.prisma.item.update({ where: { id: existing.id }, data });
          results.updated++;
        } else {
          await this.prisma.item.create({
            data: { tenantId, sku, ...data },
          });
          results.created++;
        }
      } catch (err: any) {
        results.errors.push({ row: i + 1, sku, error: err?.message ?? 'خطأ غير معروف' });
        results.skipped++;
      }
    }

    return results;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ─── FIFO/FEFO Helper ───────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════
  /**
   * يعيد اقتراح دفعات لاستهلاك كمية بأولوية FEFO (Earliest Expiry First).
   * يُستخدم من قِبَل واجهات المستخدم لعرض الدُفعات الموصى بها،
   * أو من قِبَل خدمات لاحقة لتنفيذ الاستهلاك التلقائي.
   */
  async suggestFEFO(
    tenantId: string,
    itemId: string,
    warehouseId: string,
    quantity: number,
  ) {
    const levels = await this.prisma.stockLevel.findMany({
      where: { tenantId, itemId, warehouseId, quantity: { gt: 0 } },
      include: { batch: true },
    });
    // رتّب حسب أقرب تاريخ انتهاء (nulls أخيراً)
    levels.sort((a: any, b: any) => {
      const ea = a.batch?.expiryDate ? new Date(a.batch.expiryDate).getTime() : Infinity;
      const eb = b.batch?.expiryDate ? new Date(b.batch.expiryDate).getTime() : Infinity;
      return ea - eb;
    });

    let remaining = Math.max(0, Number(quantity) || 0);
    const suggestions: { batchId: string | null; code: string | null; expiryDate: Date | null; qty: number }[] = [];
    for (const level of levels) {
      if (remaining <= 0) break;
      const available = Number(level.quantity);
      const take = Math.min(remaining, available);
      suggestions.push({
        batchId: level.batchId,
        code: level.batch?.code ?? null,
        expiryDate: level.batch?.expiryDate ?? null,
        qty: take,
      });
      remaining -= take;
    }

    const totalAvailable = levels.reduce((s: number, l: any) => s + Number(l.quantity), 0);
    return {
      quantityRequested: quantity,
      quantityAvailable: totalAvailable,
      shortage: Math.max(0, remaining),
      suggestions,
    };
  }

  async reportDeadStockCsv(tenantId: string): Promise<string> {
    const dash = await this.getDashboard(tenantId);
    const rows = dash.deadStock.map((it: any) => ({
      sku: it.sku,
      name: it.name,
      type: it.type,
    }));
    return this.toCsv(rows, [
      { key: 'sku', label: 'SKU' },
      { key: 'name', label: 'الاسم' },
      { key: 'type', label: 'النوع' },
    ]);
  }
}
