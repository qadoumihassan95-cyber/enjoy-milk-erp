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
    return this.prisma.$transaction(async (tx) => {
      const number = `EXP-${Date.now().toString(36).toUpperCase()}`;
      const expense = await tx.expense.create({
        data: {
          tenantId,
          number,
          category: data.category,
          amount: new Prisma.Decimal(data.amount),
          description: data.description,
          expenseDate: new Date(data.expenseDate ?? Date.now()),
          cashboxId: data.cashboxId,
          createdById: userId,
        },
      });

      // If paid from cashbox — deduct
      if (data.cashboxId) {
        const cashbox = await tx.cashbox.findFirst({
          where: { id: data.cashboxId, tenantId },
        });
        if (cashbox && Number(cashbox.balance) >= Number(data.amount)) {
          await tx.cashbox.update({
            where: { id: data.cashboxId },
            data: { balance: { decrement: new Prisma.Decimal(data.amount) } },
          });
          await tx.cashMovement.create({
            data: {
              tenantId,
              cashboxId: data.cashboxId,
              type: 'OUT',
              amount: new Prisma.Decimal(data.amount),
              description: data.description,
              refType: 'Expense',
              refId: expense.id,
              performedById: userId,
            },
          });
        }
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
}
