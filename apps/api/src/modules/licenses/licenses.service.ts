import { Injectable, NotFoundException } from '@nestjs/common';
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
      let computedStatus: 'VALID' | 'EXPIRING_SOON' | 'EXPIRED' = 'VALID';
      if (days < 0) computedStatus = 'EXPIRED';
      else if (days <= 30) computedStatus = 'EXPIRING_SOON';

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

  async create(tenantId: string, data: any) {
    return this.prisma.license.create({
      data: {
        tenantId,
        type: data.type,
        number: data.number,
        issueDate: new Date(data.issueDate),
        expiryDate: new Date(data.expiryDate),
        notes: data.notes,
      },
    });
  }

  async update(tenantId: string, id: string, data: any) {
    await this.get(tenantId, id);
    return this.prisma.license.update({
      where: { id },
      data: {
        type: data.type,
        number: data.number,
        issueDate: data.issueDate ? new Date(data.issueDate) : undefined,
        expiryDate: data.expiryDate ? new Date(data.expiryDate) : undefined,
        notes: data.notes,
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
