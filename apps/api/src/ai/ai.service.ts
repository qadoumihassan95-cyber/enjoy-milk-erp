/**
 * AiService — Enjoy Milk's thin NestJS wrapper around the reusable
 * `@qadoumi/erp-ai-core` package.
 *
 * The core (AiCore) is framework-free plain TypeScript. This wrapper:
 *   · Constructs AiCore at boot with a Prisma-backed AuditLogger.
 *   · Delegates chat / chatStream to AiCore verbatim.
 *   · Preserves the existing controller + FE contracts.
 *
 * Enjoy Milk-specific decisions live here:
 *   · Which persistence table to write audit rows to (Prisma).
 *   · Which env vars to read (via loadAiConfig from the package).
 *   · The enabled-modules list rendered into the context envelope.
 *
 * Future ERPs write their own AiService (or plain provider) that
 * constructs AiCore with THEIR audit logger, prompts, permission
 * gate, and tool registry. No changes are needed inside the core.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../core/prisma/prisma.service';
import {
  AiCore,
  loadAiConfig,
  type AiConfig,
  type AiRequestContext,
  type AiTier,
} from '@qadoumi/erp-ai-core';
import { PrismaAuditLogger } from './prisma-audit-logger';

@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new Logger('AiService');
  private core!: AiCore;
  private cfg!: AiConfig;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.cfg = loadAiConfig();
    this.core = new AiCore({
      config: this.cfg,
      auditLogger: new PrismaAuditLogger(this.prisma),
      erpVersion: process.env.APP_VERSION || 'dev',
      enabledModules: [
        'inventory',
        'production',
        'daily-production',
        'customers',
        'finance',
        'employees',
        'invoices',
        'licenses',
      ],
      defaultTimezone: 'Asia/Amman',
    });

    this.core.budget.onWarning((e) => {
      this.logger.warn(
        `[budget-warn] ${e.scope}/${e.window} ${e.keyId} at ${Math.round(e.fraction * 100)}% ` +
          `($${e.spent.toFixed(2)}/$${e.softLimit})`,
      );
    });

    const status = this.core.getPublicStatus();
    if (!status.configured) {
      this.logger.warn('OPENROUTER_API_KEY missing — /api/ai/* will 503 until set.');
    } else {
      this.logger.log(`AI core ready (provider: ${status.defaultProvider}).`);
    }
  }

  // ── Backward-compatible surface for the existing controller ─────
  getPublicStatus() { return this.core.getPublicStatus(); }
  getBudgetManager() { return this.core.budget; }
  getHealthMonitor() { return this.core.health; }
  getPolicyRegistry() { return this.core.policies; }
  getPromptManager() { return this.core.prompts; }
  getToolRegistry() { return this.core.toolRegistry; }
  getToolExecutor() { return this.core.toolExecutor; }
  getCache() { return this.core.cache; }

  chat(message: string, ctx: AiRequestContext, tierHint?: AiTier) {
    return this.core.chat(message, ctx, tierHint);
  }
  chatStream(message: string, ctx: AiRequestContext, tierHint?: AiTier) {
    return this.core.chatStream(message, ctx, tierHint);
  }

  static newId(): string { return AiCore.newId(); }
}
