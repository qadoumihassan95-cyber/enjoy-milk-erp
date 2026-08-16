/**
 * PrismaAuditLogger — Enjoy Milk's implementation of the core
 * AuditLogger interface. Writes every AiUsageEvent to the
 * `AiRequestLog` Prisma table.
 *
 * This lives in the CONSUMER app (Enjoy Milk), not in the core
 * package — the package must not know Prisma exists. If we later
 * spin up a second ERP, that ERP writes its own adapter against
 * Drizzle / raw SQL / whatever.
 */

import type { AuditLogger, AiUsageEvent } from '@qadoumi/erp-ai-core';
import type { PrismaService } from '../core/prisma/prisma.service';

export class PrismaAuditLogger implements AuditLogger {
  constructor(private readonly prisma: PrismaService) {}

  async record(event: AiUsageEvent): Promise<void> {
    try {
      await (this.prisma as any).aiRequestLog?.create?.({
        data: {
          tenantId: event.tenantId,
          userId: event.userId,
          conversationId: event.conversationId,
          requestId: event.requestId,
          workspace: event.workspace ?? null,
          tier: event.tier,
          provider: event.provider,
          model: event.model,
          promptTokens: event.promptTokens,
          completionTokens: event.completionTokens,
          totalTokens: event.totalTokens,
          costUsd: event.costUsd,
          latencyMs: event.latencyMs,
          success: event.success,
          retryCount: event.retryCount,
          errorMessage: event.errorMessage ?? null,
          startedAt: event.startedAt,
          finishedAt: event.finishedAt,
        },
      });
    } catch {
      // Never let audit failures break the AI pipeline. The core
      // already swallows record() errors, but be doubly defensive.
    }
  }
}
