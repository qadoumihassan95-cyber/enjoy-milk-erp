import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  tenantId?: string;
  actorUserId?: string;
  action: string; // POST | PATCH | PUT | DELETE | LOGIN | ...
  resource: string; // مسار/اسم المورد
  resourceId?: string;
  ip?: string;
}

/**
 * سجل العمليات (Audit Log) — يسجّل كل عملية تغيير (إضافة/تعديل/حذف)
 * مع من قام بها ومتى. لا يُخزّن أجسام الطلبات لتفادي تسريب بيانات حسّاسة.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** تسجيل عملية (fire-and-forget — لا يوقف الطلب أبداً) */
  async log(entry: AuditEntry): Promise<void> {
    if (!entry.tenantId) return;
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId: entry.tenantId,
          actorUserId: entry.actorUserId ?? null,
          action: entry.action,
          resource: entry.resource,
          resourceId: entry.resourceId ?? null,
          ip: entry.ip ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(`تعذّر تسجيل عملية: ${(err as Error)?.message}`);
    }
  }

  /** قائمة العمليات مع أسماء المستخدمين */
  async list(
    tenantId: string,
    opts: { limit?: number; resource?: string; action?: string } = {},
  ) {
    const logs = await this.prisma.auditLog.findMany({
      where: {
        tenantId,
        ...(opts.resource ? { resource: { contains: opts.resource } } : {}),
        ...(opts.action ? { action: opts.action } : {}),
      },
      orderBy: { occurredAt: 'desc' },
      take: Math.min(opts.limit ?? 100, 500),
    });

    // إرفاق اسم/بريد المستخدم
    const actorIds = [
      ...new Set(logs.map((l) => l.actorUserId).filter(Boolean) as string[]),
    ];
    const users = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, fullName: true, email: true },
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));

    return logs.map((l) => ({
      ...l,
      actorName: l.actorUserId ? byId.get(l.actorUserId)?.fullName ?? '—' : 'النظام',
      actorEmail: l.actorUserId ? byId.get(l.actorUserId)?.email ?? '' : '',
    }));
  }
}
