import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class LicensesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string) {
    const licenses = await this.prisma.license.findMany({
      where: { tenantId },
      orderBy: { expiryDate: 'asc' },
    });

    const now = new Date();
    return licenses.map((l) => {
      const days = Math.ceil((l.expiryDate.getTime() - now.getTime()) / 86400000);
      // إذا لم يُحدَّد renewalReminderDays نستخدم 30 يوماً كافتراضي.
      const reminder = (l as any).renewalReminderDays ?? 30;
      let computedStatus: 'VALID' | 'EXPIRING_SOON' | 'EXPIRED' = 'VALID';
      if (days < 0) computedStatus = 'EXPIRED';
      else if (days <= reminder) computedStatus = 'EXPIRING_SOON';

      return {
        ...l,
        daysRemaining: days,
        status: computedStatus,
      };
    });
  }

  async get(tenantId: string, id: string) {
    const license = await this.prisma.license.findFirst({
      where: { id, tenantId },
    });
    if (!license) throw new NotFoundException();
    return license;
  }

  // ─── Validation مشتركة بين create و update ───────
  private validate(data: {
    issueDate?: string | Date;
    expiryDate?: string | Date;
    type?: string;
    number?: string;
  }) {
    if (data.type !== undefined && !String(data.type).trim()) {
      throw new BadRequestException('نوع الرخصة مطلوب');
    }
    if (data.number !== undefined && !String(data.number).trim()) {
      throw new BadRequestException('رقم الرخصة مطلوب');
    }
    if (data.issueDate && data.expiryDate) {
      const iss = new Date(data.issueDate).getTime();
      const exp = new Date(data.expiryDate).getTime();
      if (exp < iss) {
        throw new BadRequestException('تاريخ الانتهاء لا يمكن أن يسبق تاريخ الإصدار');
      }
    }
  }

  private async assertUniqueNumber(
    tenantId: string,
    type: string,
    number: string,
    excludeId?: string,
  ) {
    const dup = await this.prisma.license.findFirst({
      where: {
        tenantId,
        type,
        number,
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
    });
    if (dup) throw new BadRequestException('يوجد رخصة أخرى بنفس النوع والرقم');
  }

  async create(tenantId: string, data: any) {
    this.validate(data);
    if (data.type && data.number) {
      await this.assertUniqueNumber(tenantId, data.type, data.number);
    }
    return this.prisma.license.create({
      data: {
        tenantId,
        type: data.type,
        number: data.number,
        issueDate: new Date(data.issueDate),
        expiryDate: new Date(data.expiryDate),
        notes: data.notes ?? null,
        issuingAuthority: data.issuingAuthority ?? null,
        renewalReminderDays: data.renewalReminderDays != null && data.renewalReminderDays !== ''
          ? Number(data.renewalReminderDays)
          : null,
        attachmentUrl: data.attachmentUrl ?? null,
        attachmentName: data.attachmentName ?? null,
      },
    });
  }

  async update(tenantId: string, id: string, data: any) {
    const existing = await this.get(tenantId, id);

    const merged = {
      type: data.type ?? existing.type,
      number: data.number ?? existing.number,
      issueDate: data.issueDate ?? existing.issueDate,
      expiryDate: data.expiryDate ?? existing.expiryDate,
    };
    this.validate(merged);

    if (
      (data.type && data.type !== existing.type) ||
      (data.number && data.number !== existing.number)
    ) {
      await this.assertUniqueNumber(tenantId, merged.type!, merged.number!, id);
    }

    return this.prisma.license.update({
      where: { id },
      data: {
        type: data.type,
        number: data.number,
        issueDate: data.issueDate ? new Date(data.issueDate) : undefined,
        expiryDate: data.expiryDate ? new Date(data.expiryDate) : undefined,
        notes: data.notes,
        issuingAuthority: data.issuingAuthority,
        renewalReminderDays:
          data.renewalReminderDays !== undefined
            ? (data.renewalReminderDays === '' || data.renewalReminderDays === null
              ? null
              : Number(data.renewalReminderDays))
            : undefined,
        attachmentUrl: data.attachmentUrl,
        attachmentName: data.attachmentName,
      },
    });
  }

  async delete(tenantId: string, id: string) {
    await this.get(tenantId, id);
    return this.prisma.license.delete({ where: { id } });
  }

  async getStats(tenantId: string) {
    const all = await this.list(tenantId);
    return {
      total: all.length,
      valid: all.filter((l) => l.status === 'VALID').length,
      expiring: all.filter((l) => l.status === 'EXPIRING_SOON').length,
      expired: all.filter((l) => l.status === 'EXPIRED').length,
    };
  }
}
