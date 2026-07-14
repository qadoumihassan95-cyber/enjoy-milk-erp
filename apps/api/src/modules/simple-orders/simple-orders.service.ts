import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { FifoCostingService } from '../fifo/fifo.service';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly fifo: FifoCostingService,
  ) {}

  // ─── List ─────────────────────────────────────────
  async list(
    tenantId: string,
    opts: { status?: string; search?: string; orderType?: string } = {},
  ) {
    return this.prisma.simpleOrder.findMany({
      where: {
        tenantId,
        ...(opts.status && { status: opts.status }),
        ...(opts.orderType && { orderType: opts.orderType }),
        ...(opts.search && {
          OR: [
            { customerName: { contains: opts.search, mode: 'insensitive' } },
            { customerPhone: { contains: opts.search } },
            { number: { contains: opts.search } },
            { contractNumber: { contains: opts.search, mode: 'insensitive' } },
            { shipmentTrackingNumber: { contains: opts.search, mode: 'insensitive' } },
          ],
        }),
      },
      include: { lines: true },
      orderBy: { orderDate: 'desc' },
      take: 200,
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

  /**
   * حساب الإجماليات المالية للطلبية بشكل موحّد (الـ source of truth).
   *   lineTotal = quantity × (tonPrice ?? order.tonPrice ?? unitPrice)
   *   productsTotal = Σ lineTotal
   *   final total = productsTotal + shippingCost
   *   paid يُحسب من مجموع الدفعات (SimpleOrderPayment).
   */
  private computeLine(l: any, orderTonPrice?: number | null) {
    const qty = Number(l.quantity || 0);
    const unit = String(l.unit || '').toUpperCase();
    const priceEach =
      Number(
        (unit === 'TON'
          ? (l.tonPrice ?? orderTonPrice ?? l.unitPrice)
          : (l.tonPrice ?? l.unitPrice ?? orderTonPrice)) || 0,
      );
    return {
      qty,
      unit: unit || null,
      tonPrice: l.tonPrice != null ? Number(l.tonPrice) : null,
      unitPrice: Number(l.unitPrice || priceEach || 0),
      lineTotal: qty * priceEach,
    };
  }

  private computeOrderTotals(lines: any[], data: { tonPrice?: any; shippingCost?: any }) {
    const orderTon = data.tonPrice != null && data.tonPrice !== '' ? Number(data.tonPrice) : null;
    const shipping = Number(data.shippingCost ?? 0) || 0;
    const computed = lines.map((l) => this.computeLine(l, orderTon));
    const productsTotal = computed.reduce((s, l) => s + l.lineTotal, 0);
    const total = productsTotal + shipping;
    return { computed, orderTon, shipping, productsTotal, total };
  }

  // ─── Create ───────────────────────────────────────
  async create(tenantId: string, userId: string, data: any) {
    const lines = data.lines ?? [];
    if (!lines.length) throw new BadRequestException('أضف منتج واحد على الأقل');

    const { computed, orderTon, shipping, productsTotal, total } =
      this.computeOrderTotals(lines, data);

    // paid: نأخذ ما أُرسل (سيُصحَّح من مجموع الدفعات لاحقاً)، محدود بالإجمالي
    const paidInput = Math.max(0, Number(data.paid ?? 0));
    const paid = Math.min(paidInput, total);
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
          productsTotal: new Prisma.Decimal(productsTotal),
          shippingCost: new Prisma.Decimal(shipping),
          tonPrice: orderTon != null ? new Prisma.Decimal(orderTon) : null,
          paid: new Prisma.Decimal(paid),
          balance: new Prisma.Decimal(balance),
          status: this.computeStatus(paid, total),
          notes: data.notes ?? null,
          createdById: userId,
          orderType: (data.orderType || 'INTERNAL').toUpperCase(),
          contractNumber: data.contractNumber ?? null,
          deliveryLocation: data.deliveryLocation ?? null,
          expectedShippingDate: data.expectedShippingDate ? new Date(data.expectedShippingDate) : null,
          expectedArrivalDate: data.expectedArrivalDate ? new Date(data.expectedArrivalDate) : null,
          shipmentTrackingNumber: data.shipmentTrackingNumber ?? null,
          lines: {
            create: lines.map((l: any, i: number) => {
              const c = computed[i];
              return {
                itemId: l.itemId ?? null,
                productName: l.productName,
                size: l.size ?? null,
                quantity: new Prisma.Decimal(c.qty),
                unitPrice: new Prisma.Decimal(c.unitPrice),
                lineTotal: new Prisma.Decimal(c.lineTotal),
                unit: c.unit,
                tonPrice: c.tonPrice != null ? new Prisma.Decimal(c.tonPrice) : null,
              };
            }),
          },
        },
        include: { lines: true },
      });

      // خصم المخزون فوراً للمنتجات المرتبطة بـ item + احتساب FIFO
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

          // ─── FIFO: توزيع التكلفة على أقدم الدفعات (best-effort) ─
          try {
            await this.fifo.consumeForSale(
              tenantId,
              {
                saleOrderId: order.id,
                saleLineId: line.id,
                itemId: line.itemId,
                quantity: Number(line.quantity),
              },
              tx,
            );
          } catch {
            /* لا توجد دفعات كافية بعد — نتجاهل بأمان،
               التوزيع يمكن أن يُنفَّذ لاحقاً عند إضافة دفعات مطابقة */
          }
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
      const orderTonRaw = data.tonPrice ?? (existing as any).tonPrice;
      const shippingRaw = data.shippingCost ?? (existing as any).shippingCost ?? 0;
      const { computed, productsTotal, total, shipping, orderTon } =
        this.computeOrderTotals(newLines, {
          tonPrice: orderTonRaw,
          shippingCost: shippingRaw,
        });
      // نأخذ الدفعات الفعلية من قاعدة البيانات كمصدر للـ paid
      const paidAgg = await tx.simpleOrderPayment.aggregate({
        where: { orderId: id },
        _sum: { amount: true },
      });
      const paid = Math.min(Number(paidAgg._sum.amount ?? 0), total);
      const balance = total - paid;

      for (let i = 0; i < newLines.length; i++) {
        const l = newLines[i];
        const c = computed[i];
        await tx.simpleOrderLine.create({
          data: {
            orderId: id,
            itemId: l.itemId ?? null,
            productName: l.productName,
            size: l.size ?? null,
            quantity: new Prisma.Decimal(c.qty),
            unitPrice: new Prisma.Decimal(c.unitPrice),
            lineTotal: new Prisma.Decimal(c.lineTotal),
            unit: c.unit,
            tonPrice: c.tonPrice != null ? new Prisma.Decimal(c.tonPrice) : null,
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
          productsTotal: new Prisma.Decimal(productsTotal),
          shippingCost: new Prisma.Decimal(shipping),
          tonPrice: orderTon != null ? new Prisma.Decimal(orderTon) : null,
          paid: new Prisma.Decimal(paid),
          balance: new Prisma.Decimal(balance),
          status: this.computeStatus(paid, total),
        },
        include: { lines: true },
      });
    });
  }

  // ─── Update meta only (no line changes) ────────────
  /**
   * تحديث خفيف للحقول العلوية للطلبية (بدون تغيير البنود ولا المخزون):
   * - نوع الطلبية، العميل، الشحن، العقد، التاريخ المتوقع...
   */
  async updateMeta(tenantId: string, id: string, data: any) {
    const existing = await this.get(tenantId, id);
    if (existing.status === 'CANCELLED') {
      throw new BadRequestException('لا يمكن تعديل طلبية ملغاة');
    }

    // إذا تغيّرت shippingCost أو tonPrice نعيد حساب total = productsTotal + shipping
    let recalc: { total: Prisma.Decimal; shipping: Prisma.Decimal; tonPrice: Prisma.Decimal | null } | null = null;
    const shippingChanged = data.shippingCost !== undefined;
    const tonPriceChanged = data.tonPrice !== undefined;
    if (shippingChanged || tonPriceChanged) {
      const shipping = Number(shippingChanged ? (data.shippingCost ?? 0) : (existing as any).shippingCost ?? 0);
      const productsTotal = Number((existing as any).productsTotal ?? 0);
      const total = productsTotal + shipping;
      const paidNow = Number(existing.paid);
      recalc = {
        total: new Prisma.Decimal(total),
        shipping: new Prisma.Decimal(shipping),
        tonPrice: tonPriceChanged
          ? (data.tonPrice === null || data.tonPrice === '' ? null : new Prisma.Decimal(Number(data.tonPrice)))
          : (existing as any).tonPrice ?? null,
      };
      // نعيد حساب الحالة والرصيد أيضاً
      await this.prisma.simpleOrder.update({
        where: { id },
        data: {
          balance: new Prisma.Decimal(Math.max(0, total - paidNow)),
          status: this.computeStatus(paidNow, total),
        },
      });
    }

    return this.prisma.simpleOrder.update({
      where: { id },
      data: {
        customerName: data.customerName ?? existing.customerName,
        customerPhone: data.customerPhone ?? existing.customerPhone,
        region: data.region ?? existing.region,
        notes: data.notes ?? existing.notes,
        orderType: data.orderType ?? existing.orderType,
        contractNumber: data.contractNumber !== undefined ? (data.contractNumber || null) : existing.contractNumber,
        deliveryLocation: data.deliveryLocation !== undefined ? (data.deliveryLocation || null) : existing.deliveryLocation,
        expectedShippingDate: data.expectedShippingDate ? new Date(data.expectedShippingDate) : existing.expectedShippingDate,
        expectedArrivalDate: data.expectedArrivalDate ? new Date(data.expectedArrivalDate) : existing.expectedArrivalDate,
        shipmentTrackingNumber: data.shipmentTrackingNumber !== undefined ? (data.shipmentTrackingNumber || null) : existing.shipmentTrackingNumber,
        ...(recalc ? { total: recalc.total, shippingCost: recalc.shipping, tonPrice: recalc.tonPrice } : {}),
      },
      include: { lines: true },
    });
  }

  // ─── Add payment ──────────────────────────────────
  /**
   * يُسجّل دفعة جديدة في جدول الدفعات + يُعيد حساب paid/balance/status للطلبية.
   * يدعم سيناريو دفعات متعددة بطرق مختلفة (كاش/حوالة/شيك/أخرى).
   * يمنع زيادة الدفع عن قيمة الطلبية إلا إذا تم تمرير allowOverpay صراحةً.
   */
  async addPayment(
    tenantId: string,
    id: string,
    body:
      | number
      | { amount: number; method?: string; notes?: string; allowOverpay?: boolean },
    userId?: string,
  ): Promise<any> {
    // دعم التوقيع القديم (رقم فقط) للتوافق العكسي
    const amount = typeof body === 'number' ? body : Number(body.amount);
    const method = (typeof body === 'object' && body.method) || 'CASH';
    const notes = typeof body === 'object' ? body.notes ?? null : null;
    const allowOverpay = typeof body === 'object' ? Boolean(body.allowOverpay) : false;

    if (!(amount > 0)) throw new BadRequestException('قيمة الدفعة يجب أن تكون أكبر من صفر');

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.simpleOrder.findFirst({ where: { id, tenantId } });
      if (!order) throw new NotFoundException();

      // عدّ الدفعات الحالية من الجدول (المرجع الرئيسي للمدفوع)
      const existingPayments = await tx.simpleOrderPayment.findMany({
        where: { orderId: id },
        orderBy: { createdAt: 'asc' },
      });
      const existingPaidFromTable = existingPayments.reduce(
        (s, p) => s + Number(p.amount),
        0,
      );

      // backfill ذكي: لو فيه paid قديم على الطلبية ولا يوجد دفعات بالجدول → أنشئ رصيد افتتاحي
      // (آمن — يحوّل البيانات القديمة لشكل قابل للعرض دون فقدان)
      const orderPaidCached = Number(order.paid);
      let basePaid = existingPaidFromTable;
      if (existingPayments.length === 0 && orderPaidCached > 0) {
        await tx.simpleOrderPayment.create({
          data: {
            tenantId,
            orderId: id,
            number: 1,
            amount: new Prisma.Decimal(orderPaidCached),
            method: 'OTHER',
            notes: 'رصيد سابق (محوّل تلقائياً من النظام القديم)',
            createdById: userId ?? null,
          },
        });
        basePaid = orderPaidCached;
      }

      const newPaid = basePaid + amount;
      const total = Number(order.total);
      if (newPaid > total && !allowOverpay) {
        throw new BadRequestException(
          `المبلغ يتجاوز إجمالي الطلبية. المتبقي: ${total - basePaid} د.أ`,
        );
      }
      const newBalance = Math.max(0, total - newPaid); // 0 للحالة المدفوعة بالكامل أو الزائدة

      // أنشئ سجل الدفعة الجديد
      const nextNumber =
        (existingPayments[existingPayments.length - 1]?.number ?? 0) +
        (existingPayments.length === 0 && orderPaidCached > 0 ? 2 : 1);
      await tx.simpleOrderPayment.create({
        data: {
          tenantId,
          orderId: id,
          number: nextNumber,
          amount: new Prisma.Decimal(amount),
          method,
          notes,
          createdById: userId ?? null,
        },
      });

      // حدّث الكاش على الطلبية (paid/balance/status)
      const updated = await tx.simpleOrder.update({
        where: { id },
        data: {
          paid: new Prisma.Decimal(newPaid),
          balance: new Prisma.Decimal(newBalance),
          status: this.computeStatus(newPaid, total),
        },
        include: { lines: true },
      });
      return updated;
    });
  }

  // ─── List payments for an order ───────────────────
  /**
   * يرجع كل دفعات الطلبية + الإجماليات.
   * يقوم بـ backfill شفاف لطلبية قديمة (paid > 0 وبدون سجلات دفعات).
   */
  async listPayments(tenantId: string, orderId: string) {
    const order = await this.prisma.simpleOrder.findFirst({
      where: { id: orderId, tenantId },
    });
    if (!order) throw new NotFoundException();

    let payments = await this.prisma.simpleOrderPayment.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });

    // Backfill شفاف: لو لا يوجد دفعات لكن الطلبية مدفوعة جزئياً/كلياً
    const orderPaid = Number(order.paid);
    if (payments.length === 0 && orderPaid > 0) {
      await this.prisma.simpleOrderPayment.create({
        data: {
          tenantId,
          orderId,
          number: 1,
          amount: new Prisma.Decimal(orderPaid),
          method: 'OTHER',
          notes: 'رصيد سابق (محوّل تلقائياً من النظام القديم)',
        },
      });
      payments = await this.prisma.simpleOrderPayment.findMany({
        where: { orderId },
        orderBy: { createdAt: 'asc' },
      });
    }

    const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);
    const total = Number(order.total);
    return {
      orderId,
      orderNumber: order.number,
      total,
      totalPaid,
      balance: Math.max(0, total - totalPaid),
      status: this.computeStatus(totalPaid, total),
      payments: payments.map((p) => ({
        id: p.id,
        number: p.number,
        amount: Number(p.amount),
        method: p.method,
        notes: p.notes,
        createdAt: p.createdAt,
        createdById: p.createdById,
      })),
    };
  }

  // ─── Delete a single payment ──────────────────────
  async deletePayment(tenantId: string, paymentId: string) {
    const payment = await this.prisma.simpleOrderPayment.findFirst({
      where: { id: paymentId, tenantId },
    });
    if (!payment) throw new NotFoundException('الدفعة غير موجودة');

    return this.prisma.$transaction(async (tx) => {
      await tx.simpleOrderPayment.delete({ where: { id: paymentId } });
      // أعِد حساب paid/balance/status للطلبية
      const remaining = await tx.simpleOrderPayment.findMany({
        where: { orderId: payment.orderId },
      });
      const newPaid = remaining.reduce((s, p) => s + Number(p.amount), 0);
      const order = await tx.simpleOrder.findUnique({ where: { id: payment.orderId } });
      if (!order) return { ok: true };
      const total = Number(order.total);
      await tx.simpleOrder.update({
        where: { id: payment.orderId },
        data: {
          paid: new Prisma.Decimal(newPaid),
          balance: new Prisma.Decimal(Math.max(0, total - newPaid)),
          status: this.computeStatus(newPaid, total),
        },
      });
      return { ok: true };
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

      // ─── FIFO: عكس التوزيع واسترجاع الرصيد إلى الدفعات ───
      try {
        await this.fifo.reverseForSale(tenantId, id, tx);
      } catch {
        /* لا توجد توزيعات — تجاهل بأمان */
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
