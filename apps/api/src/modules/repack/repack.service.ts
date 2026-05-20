import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class RepackService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Machines ────────────────────────────────────
  async listMachines(tenantId: string) {
    return this.prisma.machine.findMany({
      where: { tenantId, active: true },
      include: { line: true },
      orderBy: { code: 'asc' },
    });
  }

  // ─── Lines ───────────────────────────────────────
  async listLines(tenantId: string) {
    return this.prisma.productionLine.findMany({
      where: { tenantId, active: true },
      include: { machines: true },
      orderBy: { name: 'asc' },
    });
  }

  // ─── Quick Entry — تسجيل سريع للعمال ─────────────
  async quickEntry(tenantId: string, userId: string, dto: {
    machineId: string;
    outputUnits: number;
    wasteUnits?: number;
    downtimeMinutes?: number;
    notes?: string;
  }) {
    const machine = await this.prisma.machine.findFirst({
      where: { id: dto.machineId, tenantId, active: true },
    });
    if (!machine) throw new NotFoundException('الماكينة غير موجودة');

    return this.prisma.$transaction(async (tx) => {
      // Find active run on this machine
      let run = await tx.repackRun.findFirst({
        where: { machineId: dto.machineId, status: 'IN_PROGRESS' },
      });

      if (!run) {
        // Create a quick run without order (workers can record without an order)
        // Or find a planned order
        const order = await tx.repackOrder.findFirst({
          where: {
            tenantId,
            lineId: machine.lineId,
            status: { in: ['PLANNED', 'IN_PROGRESS'] },
          },
          orderBy: [{ createdAt: 'asc' }],
        });

        if (!order) {
          throw new BadRequestException(
            'لا يوجد أمر تعبئة نشط على هذه الماكينة. أنشئ أمر تعبئة أولاً.',
          );
        }

        run = await tx.repackRun.create({
          data: {
            tenantId,
            orderId: order.id,
            machineId: dto.machineId,
            startedAt: new Date(),
            outputUnits: new Prisma.Decimal(0),
            status: 'IN_PROGRESS',
            startedById: userId,
          },
        });

        if (order.status === 'PLANNED') {
          await tx.repackOrder.update({
            where: { id: order.id },
            data: { status: 'IN_PROGRESS' },
          });
        }
      }

      const newOutput = Number(run.outputUnits) + dto.outputUnits;
      const newWaste = Number(run.wasteUnits) + (dto.wasteUnits ?? 0);
      const newDowntime = run.downtimeMinutes + (dto.downtimeMinutes ?? 0);

      const updated = await tx.repackRun.update({
        where: { id: run.id },
        data: {
          outputUnits: new Prisma.Decimal(newOutput),
          wasteUnits: new Prisma.Decimal(newWaste),
          downtimeMinutes: newDowntime,
          notes: dto.notes
            ? run.notes
              ? `${run.notes}\n${dto.notes}`
              : dto.notes
            : run.notes,
        },
      });

      return {
        runId: updated.id,
        totalOutput: newOutput,
        totalWaste: newWaste,
        totalDowntime: newDowntime,
        action: 'recorded',
      };
    });
  }

  // ─── Active context (للعامل) ─────────────────────
  async getActiveContext(tenantId: string, machineId: string) {
    const run = await this.prisma.repackRun.findFirst({
      where: { machineId, status: 'IN_PROGRESS' },
      include: {
        order: {
          include: {
            formula: {
              include: { outputItem: true },
            },
          },
        },
        machine: true,
      },
    });

    if (!run) return null;

    return {
      runId: run.id,
      startedAt: run.startedAt,
      machine: {
        id: run.machine.id,
        name: run.machine.name,
        code: run.machine.code,
      },
      product: run.order.formula.outputItem,
      targetUnits: Number(run.order.plannedQty),
      totalOutput: Number(run.outputUnits),
      totalWaste: Number(run.wasteUnits),
      totalDowntime: run.downtimeMinutes,
    };
  }

  // ─── Complete run ────────────────────────────────
  async completeRun(tenantId: string, userId: string, runId: string) {
    const run = await this.prisma.repackRun.findFirst({
      where: { id: runId, tenantId, status: 'IN_PROGRESS' },
      include: { order: true },
    });
    if (!run) throw new NotFoundException('التشغيل غير موجود أو منتهي');

    const yieldPct = Number(run.order.plannedQty) > 0
      ? Number(run.outputUnits) / Number(run.order.plannedQty)
      : 0;

    return this.prisma.repackRun.update({
      where: { id: runId },
      data: {
        endedAt: new Date(),
        status: 'COMPLETED',
        endedById: userId,
        yieldPct: new Prisma.Decimal(yieldPct),
      },
    });
  }

  // ─── Repack Orders CRUD ──────────────────────────
  async listOrders(tenantId: string) {
    return this.prisma.repackOrder.findMany({
      where: { tenantId },
      include: {
        formula: { include: { outputItem: true } },
        line: true,
        runs: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createOrder(tenantId: string, userId: string, data: any) {
    const number = `RP-${Date.now().toString(36).toUpperCase()}`;
    return this.prisma.repackOrder.create({
      data: {
        tenantId,
        number,
        formulaId: data.formulaId,
        lineId: data.lineId,
        plannedQty: new Prisma.Decimal(data.plannedQty),
        notes: data.notes,
        createdById: userId,
      },
      include: {
        formula: { include: { outputItem: true } },
        line: true,
      },
    });
  }

  // ─── Daily summary ───────────────────────────────
  async getDailySummary(tenantId: string) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const runs = await this.prisma.repackRun.findMany({
      where: { tenantId, startedAt: { gte: start } },
    });

    const completed = runs.filter((r) => r.status === 'COMPLETED');
    const totalOutput = runs.reduce((s, r) => s + Number(r.outputUnits), 0);
    const totalWaste = runs.reduce((s, r) => s + Number(r.wasteUnits), 0);
    const wastePct = totalOutput > 0 ? totalWaste / (totalOutput + totalWaste) : 0;
    const avgYield = completed.length > 0
      ? completed.reduce((s, r) => s + Number(r.yieldPct ?? 0), 0) / completed.length
      : 0;

    return {
      activeRuns: runs.filter((r) => r.status === 'IN_PROGRESS').length,
      completedRuns: completed.length,
      totalOutput,
      totalWaste,
      wastePct,
      avgYield,
    };
  }
}
