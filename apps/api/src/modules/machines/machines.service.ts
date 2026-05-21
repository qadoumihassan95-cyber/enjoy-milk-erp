import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class MachinesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * قائمة الماكينات النشطة. إن لم توجد أي ماكينة بعد، نُنشئ
   * الماكينات الافتراضية (1، 2، 3) تلقائياً حتى لا تكون القائمة فارغة.
   */
  async list(tenantId: string) {
    const existing = await this.prisma.productionMachine.findMany({
      where: { tenantId, active: true },
      orderBy: { number: 'asc' },
    });
    if (existing.length > 0) return existing;

    // Lazy seed — الماكينات الثلاث الافتراضية للمصنع
    await this.prisma.productionMachine.createMany({
      data: [
        { tenantId, number: 1, name: 'ماكينة 1' },
        { tenantId, number: 2, name: 'ماكينة 2' },
        { tenantId, number: 3, name: 'ماكينة 3' },
      ],
      skipDuplicates: true,
    });
    return this.prisma.productionMachine.findMany({
      where: { tenantId, active: true },
      orderBy: { number: 'asc' },
    });
  }

  async create(tenantId: string, data: { number: number; name?: string }) {
    const number = Number(data.number);
    if (!Number.isInteger(number) || number <= 0) {
      throw new BadRequestException('رقم الماكينة يجب أن يكون رقماً صحيحاً موجباً');
    }
    const name = (data.name || '').trim() || `ماكينة ${number}`;

    // إن وُجدت بنفس الرقم لكنها غير نشطة — أعِد تفعيلها بدل رفض الطلب
    const dup = await this.prisma.productionMachine.findFirst({
      where: { tenantId, number },
    });
    if (dup) {
      if (dup.active) throw new BadRequestException('يوجد ماكينة بنفس الرقم');
      return this.prisma.productionMachine.update({
        where: { id: dup.id },
        data: { active: true, name },
      });
    }

    return this.prisma.productionMachine.create({
      data: { tenantId, number, name },
    });
  }

  async update(
    tenantId: string,
    id: string,
    data: { number?: number; name?: string; active?: boolean },
  ) {
    const machine = await this.prisma.productionMachine.findFirst({
      where: { id, tenantId },
    });
    if (!machine) throw new NotFoundException('الماكينة غير موجودة');

    const patch: any = {};
    if (data.number !== undefined) {
      const number = Number(data.number);
      if (!Number.isInteger(number) || number <= 0) {
        throw new BadRequestException('رقم الماكينة غير صحيح');
      }
      // امنع تكرار الرقم مع ماكينة أخرى
      const dup = await this.prisma.productionMachine.findFirst({
        where: { tenantId, number, id: { not: id } },
      });
      if (dup) throw new BadRequestException('يوجد ماكينة أخرى بنفس الرقم');
      patch.number = number;
    }
    if (data.name !== undefined) patch.name = data.name.trim() || machine.name;
    if (data.active !== undefined) patch.active = !!data.active;

    return this.prisma.productionMachine.update({ where: { id }, data: patch });
  }

  /** حذف ناعم — نُعطّل الماكينة فقط (نحافظ على سجلات الإنتاج المرتبطة) */
  async remove(tenantId: string, id: string) {
    const machine = await this.prisma.productionMachine.findFirst({
      where: { id, tenantId },
    });
    if (!machine) throw new NotFoundException('الماكينة غير موجودة');
    await this.prisma.productionMachine.update({
      where: { id },
      data: { active: false },
    });
    return { ok: true };
  }
}
