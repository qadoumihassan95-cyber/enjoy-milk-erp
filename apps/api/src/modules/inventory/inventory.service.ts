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
    return this.prisma.item.create({
      data: {
        tenantId,
        sku: data.sku,
        barcode: data.barcode,
        name: data.name,
        type: data.type,
        unit: data.unit ?? 'PCS',
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

  async listMovements(tenantId: string, opts: { limit?: number } = {}) {
    return this.prisma.stockMovement.findMany({
      where: { tenantId },
      include: {
        item: true,
        fromWarehouse: true,
        toWarehouse: true,
      },
      orderBy: { performedAt: 'desc' },
      take: opts.limit ?? 50,
    });
  }

  // ─── Snapshot ────────────────────────────────────
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
}
