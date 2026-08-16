/**
 * AuditLogger — pluggable sink for every completed / failed AI request.
 *
 * The core writes one AiUsageEvent per request; the consuming app
 * decides whether to persist it (Prisma, Drizzle, TypeORM, raw SQL),
 * ship it (Datadog, Sentry, S3), or drop it (test/dev).
 *
 * Failures inside the logger are swallowed by the core — a broken
 * audit sink must never break an AI request.
 */

import type { AiTier } from '../types/ai.types';

export interface AiUsageEvent {
  requestId: string;
  conversationId: string;
  tenantId: string;
  userId: string;
  workspace?: string | null;

  tier: AiTier;
  provider: string;
  model: string;

  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  latencyMs: number;

  success: boolean;
  retryCount: number;
  errorMessage?: string | null;
  classification?: string | null;

  startedAt: Date;
  finishedAt: Date;
}

export interface AuditLogger {
  record(event: AiUsageEvent): Promise<void> | void;
}

/** Default: log to console. Fine for dev; production plugs in Prisma. */
export class ConsoleAuditLogger implements AuditLogger {
  record(event: AiUsageEvent): void {
    // eslint-disable-next-line no-console
    console.log('[ai-audit]', JSON.stringify({
      req: event.requestId,
      tenant: event.tenantId,
      user: event.userId,
      tier: event.tier,
      provider: event.provider,
      model: event.model,
      totalTokens: event.totalTokens,
      costUsd: event.costUsd,
      latencyMs: event.latencyMs,
      success: event.success,
      retries: event.retryCount,
    }));
  }
}

/** No-op sink for tests. */
export class NullAuditLogger implements AuditLogger {
  record(_event: AiUsageEvent): void { /* ignore */ }
}
