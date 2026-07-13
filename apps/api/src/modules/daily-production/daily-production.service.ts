import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

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
      cartonUsage?: Array<{ itemId?: string; itemName: string; quantity: number; warehouseId?: string }>;
      aluminumUsage?: Array<{ itemId?: string; itemName: string; quantity: number; warehouseId?: string }>;
      milkUsage?: Array<{ itemId?: string; itemName?: string; count?: number; quantity: number; unit?: string; warehouseId?: string }>;
      produced?: Array<{ itemId?: string; itemName: string; palletsCount?: number; cartonsTotal: number; warehouseId?: string; notes?: string }>;
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

      // الكرتون
      if (data.cartonUsage?.length) {
        await tx.productionCartonUsage.createMany({
          data: data.cartonUsage.map((r) => ({
            tenantId,
            dailyProductionId: id,
            itemId: r.itemId ?? null,
            itemName: r.itemName,
            quantity: new Prisma.Decimal(r.quantity),
            warehouseId: r.warehouseId ?? null,
          })),
        });
      }

      // الألمنيوم
      if (data.aluminumUsage?.length) {
        await tx.productionAluminumUsage.createMany({
          data: data.aluminumUsage.map((r) => ({
            tenantId,
            dailyProductionId: id,
            itemId: r.itemId ?? null,
            itemName: r.itemName,
            quantity: new Prisma.Decimal(r.quantity),
            warehouseId: r.warehouseId ?? null,
          })),
        });
      }

      // الحليب
      if (data.milkUsage?.length) {
        await tx.productionMilkUsage.createMany({
          data: data.milkUsage.map((r) => ({
            tenantId,
            dailyProductionId: id,
            itemId: r.itemId ?? null,
            itemName: r.itemName ?? null,
            count: r.count ?? 0,
            quantity: new Prisma.Decimal(r.quantity),
            unit: r.unit ?? 'L',
            warehouseId: r.warehouseId ?? null,
          })),
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
            palletsCount: p.palletsCount ?? 0,
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
          data: data.wastages.map((w) => ({
            tenantId,
            dailyProductionId: id,
            itemId: w.itemId ?? null,
            itemName: w.itemName,
            quantity: new Prisma.Decimal(w.quantity),
            unit: w.unit ?? 'PCS',
            warehouseId: w.warehouseId ?? null,
            reason: w.reason ?? null,
          })),
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
  async post(tenantId: string, userId: string, id: string) {
    const dp = await this.get(tenantId, id);
    if (dp.status === 'POSTED') {
      throw new BadRequestException('تم الترحيل مسبقاً');
    }

    const rawWh = await this.prisma.warehouse.findFirst({
      where: { tenantId, code: 'BULK' },
    });
    const pkgWh = await this.prisma.warehouse.findFirst({
      where: { tenantId, code: 'PKG' },
    });
    const finWh = await this.prisma.warehouse.findFirst({
      where: { tenantId, code: 'FIN' },
    });

    return this.prisma.$transaction(async (tx) => {
      // ─── خصم الكرتون ───
      for (const c of dp.cartonUsage) {
        if (!c.itemId) continue;
        const wh = c.warehouseId ?? pkgWh?.id;
        if (!wh) continue;
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
        await this.adjustStock(tx, tenantId, c.itemId, wh, -Number(c.quantity));
      }

      // ─── خصم الألمنيوم ───
      for (const a of dp.aluminumUsage) {
        if (!a.itemId) continue;
        const wh = a.warehouseId ?? pkgWh?.id;
        if (!wh) continue;
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
        await this.adjustStock(tx, tenantId, a.itemId, wh, -Number(a.quantity));
      }

      // ─── خصم الحليب ───
      for (const m of dp.milkUsage) {
        if (!m.itemId) continue;
        const wh = m.warehouseId ?? rawWh?.id;
        if (!wh) continue;
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
        await this.adjustStock(tx, tenantId, m.itemId, wh, -Number(m.quantity));
      }

      // ─── إضافة المنتجات للمخزون النهائي ───
      for (const p of dp.produced) {
        if (!p.itemId) continue;
        const wh = p.warehouseId ?? finWh?.id;
        if (!wh) continue;
        // الكمية = مجموع الكراتين (نسجّل بعدد الكراتين كوحدة قياس)
        await tx.stockMovement.create({
          data: {
            tenantId,
            type: 'IN',
            itemId: p.itemId,
            toWarehouseId: wh,
            quantity: new Prisma.Decimal(p.cartonsTotal),
            reasonCode: 'PROD_OUTPUT',
            refType: 'DailyProduction',
            refId: dp.id,
            notes: `إنتاج: ${p.itemName} (${p.palletsCount} طبلية)`,
            performedById: userId,
          },
        });
        await this.adjustStock(tx, tenantId, p.itemId, wh, p.cartonsTotal);
      }

      // ─── خصم التوالف ───
      for (const w of dp.wastages) {
        if (!w.itemId) continue;
        const wh = w.warehouseId ?? finWh?.id;
        if (!wh) continue;
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
        await this.adjustStock(tx, tenantId, w.itemId, wh, -Number(w.quantity));
      }

      return tx.dailyProduction.update({
        where: { id },
        data: {
          status: 'POSTED',
          postedAt: new Date(),
          postedById: userId,
        },
      });
    });
  }

  // ─── Cancel (إرجاع المخزون) ───────────────────────
  async cancel(tenantId: string, userId: string, id: string) {
    const dp = await this.get(tenantId, id);
    if (dp.status !== 'POSTED') {
      throw new BadRequestException('لا يمكن إلغاء سجل لم يتم ترحيله');
    }

    return this.prisma.$transaction(async (tx) => {
      const movements = await tx.stockMovement.findMany({
        where: { tenantId, refType: 'DailyProduction', refId: id },
      });

      for (const m of movements) {
        const reverseType =
          m.type === 'IN' ? 'OUT' : m.type === 'OUT' ? 'IN' : 'IN';
        await tx.stockMovement.create({
          data: {
            tenantId,
            type: reverseType,
            itemId: m.itemId,
            fromWarehouseId:
              reverseType === 'OUT'
                ? m.toWarehouseId ?? m.fromWarehouseId
                : null,
            toWarehouseId:
              reverseType === 'IN'
                ? m.fromWarehouseId ?? m.toWarehouseId
                : null,
            quantity: m.quantity,
            reasonCode: 'REVERSAL',
            refType: 'DailyProduction-Reversal',
            refId: id,
            notes: `إلغاء حركة: ${m.notes ?? ''}`,
            performedById: userId,
          },
        });
        const wh =
          reverseType === 'IN'
            ? m.fromWarehouseId ?? m.toWarehouseId
            : m.toWarehouseId ?? m.fromWarehouseId;
        if (wh && m.itemId) {
          const delta =
            reverseType === 'IN' ? Number(m.quantity) : -Number(m.quantity);
          await this.adjustStock(tx, tenantId, m.itemId, wh, delta);
        }
      }

      return tx.dailyProduction.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });
    });
  }

  // ─── Daily Report ─────────────────────────────────
  async dailyReport(tenantId: string, date: Date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86400000);

    const records = await this.prisma.dailyProduction.findMany({
      where: { tenantId, productionDate: { gte: start, lt: end } },
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
    let totalPallets = 0;
    let totalMilk = 0;
    let totalAluminum = 0;
    let totalCartonUsage = 0;

    for (const r of records) {
      for (const p of r.produced) {
        productionTotals[p.itemName] =
          (productionTotals[p.itemName] ?? 0) + p.cartonsTotal;
        totalCartons += p.cartonsTotal;
        totalPallets += p.palletsCount;
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
      records,
      summary: {
        totalCartons,
        totalPallets,
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

    const records = await this.prisma.dailyProduction.findMany({
      where: { tenantId, productionDate: { gte: start, lt: end } },
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
    let totalPallets = 0;
    let totalMilk = 0;
    let totalAluminum = 0;
    let totalCartonUsage = 0;
    let totalWaste = 0;
    const byItem: Record<string, { totalCartons: number; totalPallets: number }> = {};
    const itemsProduced = new Set<string>();
    const notes: string[] = [];

    // ─── تحويل الحليب: كل كيس = 25 كغ ─────────────────
    // إذا احتوى السطر على count (عدد الأكياس) نُرجّح count*25، وإلا نستخدم quantity كما هو.
    // (السطور القديمة بالوحدات القديمة كـ L أو KG تُحفظ كما هي؛ العبوات الجديدة تُعامل معاملة أكياس.)
    const BAG_KG = 25;
    let totalMilkKg = 0;
    let totalMilkBags = 0;
    for (const r of records) {
      if (r.notes?.trim()) notes.push(`${r.shift || ''} — ${r.notes}`);
      for (const m of r.milkUsage) {
        const c = Number(m.count || 0);
        const q = Number(m.quantity || 0);
        if (c > 0) {
          totalMilkBags += c;
          totalMilkKg += c * BAG_KG;
        } else {
          totalMilkKg += q; // مدخل بالكيلو مباشرة
        }
        totalMilk += q; // للتوافق الرجعي (المجموع الخام)
      }
      totalAluminum += r.aluminumUsage.reduce((s, a) => s + Number(a.quantity || 0), 0);
      totalCartonUsage += r.cartonUsage.reduce((s, c) => s + Number(c.quantity || 0), 0);
      totalWaste += r.wastages.reduce((s, w) => s + Number(w.quantity || 0), 0);

      for (const p of r.produced.filter(filterItem)) {
        const item = p.itemName || '(بدون اسم)';
        itemsProduced.add(item);
        const c = Number(p.cartonsTotal || 0);
        const pl = Number(p.palletsCount || 0);
        totalCartons += c;
        totalPallets += pl;
        if (!byItem[item]) byItem[item] = { totalCartons: 0, totalPallets: 0 };
        byItem[item].totalCartons += c;
        byItem[item].totalPallets += pl;
      }
    }

    // نستخدم totalMilkKg الفعلي في نسب الفاقد والإنتاج/المدخل
    const wasteRate = totalMilkKg > 0 ? round((totalWaste / totalMilkKg) * 100, 2) : 0;
    const inputOutputRatio = totalMilkKg > 0 ? round(totalCartons / totalMilkKg, 4) : 0;

    return {
      date: start.toISOString().slice(0, 10),
      filter: { itemName: opts.itemName ?? null },
      recordsCount: records.length,
      itemsProduced: Array.from(itemsProduced).sort(),
      totals: {
        cartons: totalCartons,
        pallets: totalPallets,
        rawMilk: round(totalMilk, 2),
        // ─── جديد: إجمالي الحليب بالكيلو (1 كيس = 25 كغ) ─
        rawMilkKg: round(totalMilkKg, 2),
        milkBags: totalMilkBags,
        bagWeightKg: BAG_KG,
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
  private async adjustStock(
    tx: any,
    tenantId: string,
    itemId: string,
    warehouseId: string,
    delta: number,
  ) {
    const existing = await tx.stockLevel.findFirst({
      where: { itemId, warehouseId, batchId: null },
    });
    if (existing) {
      const newQty = Number(existing.quantity) + delta;
      await tx.stockLevel.update({
        where: { id: existing.id },
        data: { quantity: new Prisma.Decimal(Math.max(0, newQty)) },
      });
    } else if (delta > 0) {
      await tx.stockLevel.create({
        data: {
          tenantId,
          itemId,
          warehouseId,
          quantity: new Prisma.Decimal(delta),
        },
      });
    }
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
