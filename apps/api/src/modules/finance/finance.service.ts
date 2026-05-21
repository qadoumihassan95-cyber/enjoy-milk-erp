import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Cashboxes ───────────────────────────────────
  async listCashboxes(tenantId: string) {
    return this.prisma.cashbox.findMany({
      where: { tenantId, active: true },
      orderBy: { name: 'asc' },
    });
  }

  async createCashbox(tenantId: string, data: any) {
    return this.prisma.cashbox.create({
      data: {
        tenantId,
        code: data.code,
        name: data.name,
        balance: new Prisma.Decimal(data.openingBalance ?? 0),
      },
    });
  }

  // ─── Cash Movements ──────────────────────────────
  async addMovement(tenantId: string, userId: string, data: any) {
    return this.prisma.$transaction(async (tx) => {
      const cashbox = await tx.cashbox.findFirst({
        where: { id: data.cashboxId, tenantId },
      });
      if (!cashbox) throw new NotFoundException('الصندوق غير موجود');

      const amount = Number(data.amount);
      const delta = data.type === 'IN' ? amount : -amount;

      if (data.type === 'OUT' && Number(cashbox.balance) < amount) {
        throw new BadRequestException('الرصيد لا يكفي');
      }

      await tx.cashbox.update({
        where: { id: data.cashboxId },
        data: { balance: { increment: new Prisma.Decimal(delta) } },
      });

      return tx.cashMovement.create({
        data: {
          tenantId,
          cashboxId: data.cashboxId,
          type: data.type,
          amount: new Prisma.Decimal(amount),
          description: data.description,
          performedById: userId,
        },
      });
    });
  }

  // ─── Transfer between cashboxes ──────────────────
  async transferBetweenCashboxes(
    tenantId: string,
    userId: string,
    data: { fromCashboxId: string; toCashboxId: string; amount: number; description?: string },
  ) {
    const amount = Number(data.amount);
    if (!data.fromCashboxId || !data.toCashboxId) {
      throw new BadRequestException('يجب اختيار الصندوق المُرسِل والمستلم');
    }
    if (data.fromCashboxId === data.toCashboxId) {
      throw new BadRequestException('لا يمكن التحويل لنفس الصندوق');
    }
    if (!(amount > 0)) {
      throw new BadRequestException('المبلغ غير صحيح');
    }

    return this.prisma.$transaction(async (tx) => {
      const [from, to] = await Promise.all([
        tx.cashbox.findFirst({ where: { id: data.fromCashboxId, tenantId } }),
        tx.cashbox.findFirst({ where: { id: data.toCashboxId, tenantId } }),
      ]);
      if (!from || !to) throw new NotFoundException('الصندوق غير موجود');
      if (Number(from.balance) < amount) {
        throw new BadRequestException('رصيد الصندوق المُرسِل لا يكفي');
      }

      const dec = new Prisma.Decimal(amount);
      await tx.cashbox.update({
        where: { id: from.id },
        data: { balance: { decrement: dec } },
      });
      await tx.cashbox.update({
        where: { id: to.id },
        data: { balance: { increment: dec } },
      });

      const desc = data.description?.trim() || `تحويل من ${from.name} إلى ${to.name}`;
      await tx.cashMovement.create({
        data: {
          tenantId,
          cashboxId: from.id,
          type: 'TRANSFER',
          amount: dec,
          description: `تحويل صادر → ${to.name}${data.description ? ' — ' + data.description : ''}`,
          refType: 'Transfer',
          performedById: userId,
        },
      });
      await tx.cashMovement.create({
        data: {
          tenantId,
          cashboxId: to.id,
          type: 'TRANSFER',
          amount: dec,
          description: `تحويل وارد ← ${from.name}${data.description ? ' — ' + data.description : ''}`,
          refType: 'Transfer',
          performedById: userId,
        },
      });

      return { ok: true, message: desc, amount };
    });
  }

  async listMovements(tenantId: string, cashboxId?: string) {
    return this.prisma.cashMovement.findMany({
      where: {
        tenantId,
        ...(cashboxId && { cashboxId }),
      },
      include: { cashbox: true },
      orderBy: { performedAt: 'desc' },
      take: 100,
    });
  }

  // ─── Cheques ─────────────────────────────────────
  async listCheques(tenantId: string, status?: string) {
    return this.prisma.cheque.findMany({
      where: {
        tenantId,
        ...(status && { status: status as any }),
      },
      orderBy: { dueDate: 'asc' },
    });
  }

  async createCheque(tenantId: string, data: any) {
    return this.prisma.cheque.create({
      data: {
        tenantId,
        type: data.type,
        number: data.number,
        bankName: data.bankName,
        amount: new Prisma.Decimal(data.amount),
        issueDate: new Date(data.issueDate),
        dueDate: new Date(data.dueDate),
        status: 'IN_HAND',
        customerId: data.customerId,
        notes: data.notes,
      },
    });
  }

  async updateChequeStatus(tenantId: string, id: string, status: string) {
    const cheque = await this.prisma.cheque.findFirst({
      where: { id, tenantId },
    });
    if (!cheque) throw new NotFoundException();

    return this.prisma.cheque.update({
      where: { id },
      data: { status: status as any },
    });
  }

  async getUpcomingCheques(tenantId: string) {
    const now = new Date();
    const in7days = new Date(now.getTime() + 7 * 86400000);
    return this.prisma.cheque.findMany({
      where: {
        tenantId,
        status: { in: ['IN_HAND', 'DEPOSITED'] },
        dueDate: { gte: now, lte: in7days },
      },
      orderBy: { dueDate: 'asc' },
    });
  }

  // ─── Expenses ────────────────────────────────────
  async listExpenses(tenantId: string) {
    return this.prisma.expense.findMany({
      where: { tenantId },
      orderBy: { expenseDate: 'desc' },
      take: 100,
    });
  }

  async createExpense(tenantId: string, userId: string, data: any) {
    const amount = new Prisma.Decimal(data.amount);
    return this.prisma.$transaction(async (tx) => {
      const number = `EXP-${Date.now().toString(36).toUpperCase()}`;

      // تحديد الصندوق: المُرسل، أو الرئيسي (MAIN)، أو أول صندوق نشِط
      let cashboxId: string | null = data.cashboxId ?? null;
      if (!cashboxId) {
        const cb =
          (await tx.cashbox.findFirst({ where: { tenantId, active: true, code: 'MAIN' } })) ??
          (await tx.cashbox.findFirst({ where: { tenantId, active: true }, orderBy: { code: 'asc' } }));
        cashboxId = cb?.id ?? null;
      }

      const expense = await tx.expense.create({
        data: {
          tenantId,
          number,
          category: data.category,
          amount,
          description: data.description,
          expenseDate: new Date(data.expenseDate ?? Date.now()),
          cashboxId,
          createdById: userId,
        },
      });

      // الخصم من الصندوق دائماً (يعكس الواقع المالي) + تسجيل حركة نقدية
      if (cashboxId) {
        await tx.cashbox.update({
          where: { id: cashboxId },
          data: { balance: { decrement: amount } },
        });
        await tx.cashMovement.create({
          data: {
            tenantId,
            cashboxId,
            type: 'OUT',
            amount,
            description: `مصروف: ${data.category || ''} ${data.description ? '— ' + data.description : ''}`.trim(),
            refType: 'Expense',
            refId: expense.id,
            performedById: userId,
          },
        });
      }

      return expense;
    });
  }

  // ─── Summary ─────────────────────────────────────
  async getDailySummary(tenantId: string) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const cashboxes = await this.prisma.cashbox.findMany({
      where: { tenantId, active: true },
    });
    const totalBalance = cashboxes.reduce((s, c) => s + Number(c.balance), 0);

    const movements = await this.prisma.cashMovement.findMany({
      where: { tenantId, performedAt: { gte: start } },
    });
    const cashIn = movements
      .filter((m) => m.type === 'IN')
      .reduce((s, m) => s + Number(m.amount), 0);
    const cashOut = movements
      .filter((m) => m.type === 'OUT')
      .reduce((s, m) => s + Number(m.amount), 0);

    const expenses = await this.prisma.expense.aggregate({
      where: { tenantId, expenseDate: { gte: start } },
      _sum: { amount: true },
    });

    const upcomingCheques = await this.getUpcomingCheques(tenantId);

    return {
      totalBalance,
      cashIn,
      cashOut,
      net: cashIn - cashOut,
      expensesPaid: Number(expenses._sum.amount ?? 0),
      upcomingChequesCount: upcomingCheques.length,
      cashboxes,
    };
  }

  // ─── تقرير مالي شامل (إيرادات/مصاريف/أرباح + اتجاه) ─────────
  async getFinancialReport(tenantId: string, fromStr?: string, toStr?: string) {
    const to = toStr ? new Date(toStr) : new Date();
    const from = fromStr
      ? new Date(fromStr)
      : new Date(to.getFullYear(), to.getMonth(), 1); // افتراضي: بداية الشهر الحالي

    // ── الإيرادات (من الطلبيات غير الملغاة) ──
    const orders = await this.prisma.simpleOrder.findMany({
      where: {
        tenantId,
        orderDate: { gte: from, lte: to },
        status: { not: 'CANCELLED' },
      },
      select: { total: true, paid: true, balance: true },
    });
    const totalSales = orders.reduce((s, o) => s + Number(o.total), 0);
    const collected = orders.reduce((s, o) => s + Number(o.paid), 0);
    const outstanding = orders.reduce((s, o) => s + Number(o.balance), 0);

    // ── المصاريف حسب التصنيف ──
    const expenses = await this.prisma.expense.findMany({
      where: { tenantId, expenseDate: { gte: from, lte: to } },
      select: { category: true, amount: true },
    });
    const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
    const byCategory: Record<string, number> = {};
    for (const e of expenses) {
      const cat = e.category || 'أخرى';
      byCategory[cat] = (byCategory[cat] || 0) + Number(e.amount);
    }

    const profit = totalSales - totalExpenses;
    const margin = totalSales > 0 ? (profit / totalSales) * 100 : 0;

    // ── اتجاه آخر 6 أشهر ──
    const trend: { month: string; sales: number; expenses: number; profit: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const mStart = new Date(to.getFullYear(), to.getMonth() - i, 1);
      const mEnd = new Date(to.getFullYear(), to.getMonth() - i + 1, 1);
      const [mOrders, mExp] = await Promise.all([
        this.prisma.simpleOrder.aggregate({
          where: {
            tenantId,
            orderDate: { gte: mStart, lt: mEnd },
            status: { not: 'CANCELLED' },
          },
          _sum: { total: true },
        }),
        this.prisma.expense.aggregate({
          where: { tenantId, expenseDate: { gte: mStart, lt: mEnd } },
          _sum: { amount: true },
        }),
      ]);
      const sales = Number(mOrders._sum.total ?? 0);
      const exp = Number(mExp._sum.amount ?? 0);
      trend.push({
        month: mStart.toLocaleDateString('ar-EG', { month: 'short' }),
        sales,
        expenses: exp,
        profit: sales - exp,
      });
    }

    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      totalSales,
      collected,
      outstanding,
      totalExpenses,
      profit,
      margin: Math.round(margin * 10) / 10,
      byCategory,
      trend,
    };
  }
}
