import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';

/**
 * Simple Orders Service
 *
 * طلبية بسيطة (بدون فواتير محاسبية):
 *  - اسم العميل + هاتف + منطقة
 *  - منتجات (اسم + حجم + كمية + سعر)
 *  - مدفوع / متبقي / حالة
 *
 * المنطق الحرج:
 *  - عند إنشاء طلبية → خصم المخزون فوراً
 *  - عند تعديل → إرجاع القديم وخصم الجديد
 *  - عند حذف → إرجاع المخزون كاملاً
 */
@Injectable()
export class SimpleOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── List ─────────────────────────────────────────
  async list(
    tenantId: string,
    opts: { status?: string; search?: string } = {},
  ) {
    return this.prisma.simpleOrder.findMany({
      where: {
        tenantId,
        ...(opts.status && { status: opts.status }),
        ...(opts.search && {
          OR: [
            { customerName: { contains: opts.search, mode: 'insensitive' } },
            { customerPhone: { contains: opts.search } },
            { number: { contains: opts.search } },
          ],
        }),
      },
      include: { lines: true },
      orderBy: { orderDate: 'desc' },
      take: 100,
    });
  }

  // ─── Get one ──────────────────────────────────────
  async get(tenantId: string, id: string) {
    const order = await this.prisma.simpleOrder.findFirst({
      where: { id, tenantId },
      include: { lines: true },
    });
    if (!order) throw new NotFoundException('الطلبية غير موجودة');
    return order;
  }

  // ─── Create ───────────────────────────────────────
  async create(tenantId: string, userId: string, data: any) {
    const lines = data.lines ?? [];
    if (!lines.length) throw new BadRequestException('أضف منتج واحد على الأقل');

    const total = lines.reduce(
      (s: number, l: any) => s + Number(l.quantity) * Number(l.unitPrice),
      0,
    );
    const paid = Math.min(Number(data.paid ?? 0), total);
    const balance = total - paid;

    return this.prisma.$transaction(async (tx) => {
      const number = await this.nextOrderNumber(tx, tenantId);

      const order = await tx.simpleOrder.create({
        data: {
          tenantId,
          number,
          customerId: data.customerId ?? null,
          customerName: data.customerName,
          customerPhone: data.customerPhone ?? null,
          region: data.region ?? null,
          orderDate: data.orderDate ? new Date(data.orderDate) : new Date(),
          total: new Prisma.Decimal(total),
          paid: new Prisma.Decimal(paid),
          balance: new Prisma.Decimal(balance),
          status: this.computeStatus(paid, total),
          notes: data.notes ?? null,
          createdById: userId,
          lines: {
            create: lines.map((l: any) => ({
              itemId: l.itemId ?? null,
              productName: l.productName,
              size: l.size ?? null,
              quantity: new Prisma.Decimal(l.quantity),
              unitPrice: new Prisma.Decimal(l.unitPrice),
              lineTotal: new Prisma.Decimal(
                Number(l.quantity) * Number(l.unitPrice),
              ),
            })),
          },
        },
        include: { lines: true },
      });

      // خصم المخزون فوراً للمنتجات المرتبطة بـ item
      const finWh = await tx.warehouse.findFirst({
        where: { tenantId, code: 'FIN' },
      });
      for (const line of order.lines) {
        if (line.itemId && finWh) {
          await this.deductStock(
            tx,
            tenantId,
            line.itemId,
            finWh.id,
            Number(line.quantity),
          );
          await tx.stockMovement.create({
            data: {
              tenantId,
              type: 'OUT',
              itemId: line.itemId,
              fromWarehouseId: finWh.id,
              quantity: line.quantity,
              reasonCode: 'ORDER',
              refType: 'SimpleOrder',
              refId: order.id,
              notes: `طلبية ${order.number} — ${order.customerName}`,
              performedById: userId,
            },
          });
        }
      }

      return order;
    });
  }

  // ─── Update ───────────────────────────────────────
  async update(tenantId: string, userId: string, id: string, data: any) {
    const existing = await this.get(tenantId, id);
    if (existing.status === 'CANCELLED') {
      throw new BadRequestException('لا يمكن تعديل طلبية ملغاة');
    }

    return this.prisma.$transaction(async (tx) => {
      // 1) أرجع المخزون من البنود القديمة
      const finWh = await tx.warehouse.findFirst({
        where: { tenantId, code: 'FIN' },
      });
      for (const line of existing.lines) {
        if (line.itemId && finWh) {
          await this.adjustStock(
            tx,
            tenantId,
            line.itemId,
            finWh.id,
            Number(line.quantity),
          );
        }
      }

      // 2) احذف البنود القديمة
      await tx.simpleOrderLine.deleteMany({ where: { orderId: id } });

      // 3) أضف البنود الجديدة + خصم المخزون
      const newLines = data.lines ?? [];
      const total = newLines.reduce(
        (s: number, l: any) =>
          s + Number(l.quantity) * Number(l.unitPrice),
        0,
      );
      const paid = Math.min(Number(data.paid ?? existing.paid), total);
      const balance = total - paid;

      for (const l of newLines) {
        await tx.simpleOrderLine.create({
          data: {
            orderId: id,
            itemId: l.itemId ?? null,
            productName: l.productName,
            size: l.size ?? null,
            quantity: new Prisma.Decimal(l.quantity),
            unitPrice: new Prisma.Decimal(l.unitPrice),
            lineTotal: new Prisma.Decimal(
              Number(l.quantity) * Number(l.unitPrice),
            ),
          },
        });

        if (l.itemId && finWh) {
          await this.deductStock(
            tx,
            tenantId,
            l.itemId,
            finWh.id,
            Number(l.quantity),
          );
          await tx.stockMovement.create({
            data: {
              tenantId,
              type: 'OUT',
              itemId: l.itemId,
              fromWarehouseId: finWh.id,
              quantity: new Prisma.Decimal(l.quantity),
              reasonCode: 'ORDER_UPDATE',
              refType: 'SimpleOrder',
              refId: id,
              notes: `تعديل طلبية ${existing.number}`,
              performedById: userId,
            },
          });
        }
      }

      // 4) حدّث الـ header
      return tx.simpleOrder.update({
        where: { id },
        data: {
          customerName: data.customerName ?? existing.customerName,
          customerPhone: data.customerPhone ?? existing.customerPhone,
          region: data.region ?? existing.region,
          notes: data.notes ?? existing.notes,
          total: new Prisma.Decimal(total),
          paid: new Prisma.Decimal(paid),
          balance: new Prisma.Decimal(balance),
          status: this.computeStatus(paid, total),
        },
        include: { lines: true },
      });
    });
  }

  // ─── Add payment ──────────────────────────────────
  async addPayment(
    tenantId: string,
    id: string,
    amount: number,
  ): Promise<any> {
    const order = await this.get(tenantId, id);
    const newPaid = Number(order.paid) + amount;
    if (newPaid > Number(order.total)) {
      throw new BadRequestException('المبلغ يتجاوز إجمالي الطلبية');
    }
    const newBalance = Number(order.total) - newPaid;

    return this.prisma.simpleOrder.update({
      where: { id },
      data: {
        paid: new Prisma.Decimal(newPaid),
        balance: new Prisma.Decimal(newBalance),
        status: this.computeStatus(newPaid, Number(order.total)),
      },
      include: { lines: true },
    });
  }

  // ─── Delete ───────────────────────────────────────
  async delete(tenantId: string, userId: string, id: string) {
    const order = await this.get(tenantId, id);

    return this.prisma.$transaction(async (tx) => {
      // أرجع المخزون لكل البنود
      const finWh = await tx.warehouse.findFirst({
        where: { tenantId, code: 'FIN' },
      });
      for (const line of order.lines) {
        if (line.itemId && finWh) {
          await this.adjustStock(
            tx,
            tenantId,
            line.itemId,
            finWh.id,
            Number(line.quantity),
          );
          await tx.stockMovement.create({
            data: {
              tenantId,
              type: 'IN',
              itemId: line.itemId,
              toWarehouseId: finWh.id,
              quantity: line.quantity,
              reasonCode: 'ORDER_CANCEL',
              refType: 'SimpleOrder',
              refId: id,
              notes: `إرجاع كمية بسبب حذف طلبية ${order.number}`,
              performedById: userId,
            },
          });
        }
      }

      await tx.simpleOrder.delete({ where: { id } });
      return { ok: true };
    });
  }

  // ─── Report ───────────────────────────────────────
  async report(tenantId: string) {
    const orders = await this.prisma.simpleOrder.findMany({
      where: { tenantId, status: { not: 'CANCELLED' } },
    });
    const totalAmount = orders.reduce((s, o) => s + Number(o.total), 0);
    const totalPaid = orders.reduce((s, o) => s + Number(o.paid), 0);
    const totalBalance = orders.reduce((s, o) => s + Number(o.balance), 0);
    const unpaidOrders = orders.filter((o) => Number(o.balance) > 0);

    return {
      ordersCount: orders.length,
      totalAmount,
      totalPaid,
      totalBalance,
      unpaidOrdersCount: unpaidOrders.length,
      unpaidOrders: unpaidOrders.slice(0, 20).map((o) => ({
        id: o.id,
        number: o.number,
        customerName: o.customerName,
        total: Number(o.total),
        paid: Number(o.paid),
        balance: Number(o.balance),
        status: o.status,
      })),
    };
  }

  // ─── Helpers ──────────────────────────────────────
  private computeStatus(paid: number, total: number): string {
    if (total <= 0) return 'PAID';
    if (paid <= 0) return 'UNPAID';
    if (paid >= total) return 'PAID';
    return 'PARTIAL';
  }

  private async nextOrderNumber(tx: any, tenantId: string): Promise<string> {
    const year = new Date().getFullYear();
    const count = await tx.simpleOrder.count({
      where: { tenantId, number: { startsWith: `ORD-${year}-` } },
    });
    return `ORD-${year}-${String(count + 1).padStart(4, '0')}`;
  }

  private async deductStock(
    tx: any,
    tenantId: string,
    itemId: string,
    warehouseId: string,
    qty: number,
  ) {
    const existing = await tx.stockLevel.findFirst({
      where: { itemId, warehouseId, batchId: null },
    });
    if (existing) {
      const newQty = Number(existing.quantity) - qty;
      await tx.stockLevel.update({
        where: { id: existing.id },
        data: { quantity: new Prisma.Decimal(Math.max(0, newQty)) },
      });
    }
    // لو ما في stock level — لا نرمي خطأ، فقط نسجل الحركة
  }

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
      await tx.stockLevel.update({
        where: { id: existing.id },
        data: {
          quantity: new Prisma.Decimal(Number(existing.quantity) + delta),
        },
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
}
