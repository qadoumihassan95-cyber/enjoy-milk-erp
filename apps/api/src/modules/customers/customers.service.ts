import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Customers CRUD ──────────────────────────────
  async list(tenantId: string, search?: string) {
    return this.prisma.customer.findMany({
      where: {
        tenantId,
        active: true,
        ...(search && {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { code: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search } },
          ],
        }),
      },
      orderBy: { name: 'asc' },
    });
  }

  async get(tenantId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, tenantId },
      include: {
        orders: { orderBy: { orderDate: 'desc' }, take: 10 },
        payments: { orderBy: { receivedAt: 'desc' }, take: 10 },
      },
    });
    if (!customer) throw new NotFoundException('العميل غير موجود');

    const totalOrders = await this.prisma.salesOrder.aggregate({
      where: { tenantId, customerId: id },
      _sum: { total: true },
    });
    const totalPaid = await this.prisma.payment.aggregate({
      where: { tenantId, customerId: id },
      _sum: { amount: true },
    });

    return {
      ...customer,
      totalOrdersAmount: Number(totalOrders._sum.total ?? 0),
      totalPaidAmount: Number(totalPaid._sum.amount ?? 0),
      outstandingBalance:
        Number(totalOrders._sum.total ?? 0) - Number(totalPaid._sum.amount ?? 0),
    };
  }

  async create(tenantId: string, data: any) {
    const code = data.code || `C-${Date.now().toString(36).toUpperCase()}`;
    return this.prisma.customer.create({
      data: {
        tenantId,
        code,
        name: data.name,
        type: data.type ?? 'RETAIL',
        phone: data.phone,
        email: data.email,
        address: data.address,
        creditLimit: data.creditLimit ? new Prisma.Decimal(data.creditLimit) : new Prisma.Decimal(0),
        paymentTerms: data.paymentTerms ?? 0,
      },
    });
  }

  async update(tenantId: string, id: string, data: any) {
    await this.get(tenantId, id);
    return this.prisma.customer.update({
      where: { id },
      data: {
        name: data.name,
        type: data.type,
        phone: data.phone,
        email: data.email,
        address: data.address,
        creditLimit: data.creditLimit ? new Prisma.Decimal(data.creditLimit) : undefined,
        paymentTerms: data.paymentTerms,
      },
    });
  }

  async delete(tenantId: string, id: string) {
    await this.get(tenantId, id);
    return this.prisma.customer.update({
      where: { id },
      data: { active: false },
    });
  }

  // ─── Orders ──────────────────────────────────────
  async listOrders(tenantId: string) {
    return this.prisma.salesOrder.findMany({
      where: { tenantId },
      include: { customer: true, lines: true },
      orderBy: { orderDate: 'desc' },
      take: 100,
    });
  }

  async createOrder(tenantId: string, userId: string, data: any) {
    return this.prisma.$transaction(async (tx) => {
      const number = `SO-${Date.now().toString(36).toUpperCase()}`;
      const subtotal = data.lines.reduce((s: number, l: any) => s + l.quantity * l.unitPrice, 0);

      const order = await tx.salesOrder.create({
        data: {
          tenantId,
          number,
          customerId: data.customerId,
          orderDate: new Date(),
          deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : null,
          status: 'CONFIRMED',
          subtotal: new Prisma.Decimal(subtotal),
          total: new Prisma.Decimal(subtotal),
          balance: new Prisma.Decimal(subtotal),
          notes: data.notes,
          lines: {
            create: data.lines.map((l: any) => ({
              itemId: l.itemId,
              quantity: new Prisma.Decimal(l.quantity),
              unitPrice: new Prisma.Decimal(l.unitPrice),
              lineTotal: new Prisma.Decimal(l.quantity * l.unitPrice),
            })),
          },
        },
        include: { lines: true, customer: true },
      });

      return order;
    });
  }

  // ─── Payments ────────────────────────────────────
  async listPayments(tenantId: string) {
    return this.prisma.payment.findMany({
      where: { tenantId },
      include: { customer: true, order: true },
      orderBy: { receivedAt: 'desc' },
      take: 100,
    });
  }

  async createPayment(tenantId: string, userId: string, data: any) {
    return this.prisma.$transaction(async (tx) => {
      const number = `PAY-${Date.now().toString(36).toUpperCase()}`;
      const payment = await tx.payment.create({
        data: {
          tenantId,
          customerId: data.customerId,
          orderId: data.orderId,
          number,
          amount: new Prisma.Decimal(data.amount),
          method: data.method ?? 'CASH',
          cashboxId: data.cashboxId,
          notes: data.notes,
          receivedById: userId,
        },
      });

      // Update order balance if linked
      if (data.orderId) {
        const order = await tx.salesOrder.findUnique({
          where: { id: data.orderId },
        });
        if (order) {
          const newPaid = Number(order.paid) + data.amount;
          const newBalance = Number(order.total) - newPaid;
          await tx.salesOrder.update({
            where: { id: data.orderId },
            data: {
              paid: new Prisma.Decimal(newPaid),
              balance: new Prisma.Decimal(newBalance),
              status: newBalance <= 0 ? 'PAID' : order.status,
            },
          });
        }
      }

      // Update cashbox if cash payment
      if (data.cashboxId && data.method === 'CASH') {
        await tx.cashbox.update({
          where: { id: data.cashboxId },
          data: { balance: { increment: new Prisma.Decimal(data.amount) } },
        });
        await tx.cashMovement.create({
          data: {
            tenantId,
            cashboxId: data.cashboxId,
            type: 'IN',
            amount: new Prisma.Decimal(data.amount),
            description: `دفعة من العميل ${data.customerId}`,
            refType: 'Payment',
            refId: payment.id,
            performedById: userId,
          },
        });
      }

      return payment;
    });
  }

  async getCustomerStats(tenantId: string) {
    const customers = await this.prisma.customer.findMany({
      where: { tenantId, active: true },
    });

    const totals = await Promise.all(
      customers.map(async (c) => {
        const orders = await this.prisma.salesOrder.aggregate({
          where: { tenantId, customerId: c.id },
          _sum: { total: true, paid: true },
        });
        return {
          customer: c,
          totalOrders: Number(orders._sum.total ?? 0),
          totalPaid: Number(orders._sum.paid ?? 0),
          outstanding: Number(orders._sum.total ?? 0) - Number(orders._sum.paid ?? 0),
        };
      }),
    );

    return totals;
  }
}
