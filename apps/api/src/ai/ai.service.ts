/**
 * AiService — orchestrates every AI call in the ERP.
 *
 * Responsibilities:
 *   - Load config once at construction.
 *   - Instantiate providers (OpenRouter today; more later).
 *   - Route each request to the right tier + fall back within a tier
 *     if a model fails.
 *   - Enforce per-user rate limits.
 *   - Persist a safe audit row per request (tokens / cost / latency /
 *     model / provider / user — NEVER the API key or the raw prompt).
 *
 * Provider-agnostic by design: the rest of the app depends on this
 * service and on the AiProvider interface. It DOES NOT know that
 * OpenRouter exists.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../core/prisma/prisma.service';
import type {
  AiCompletion,
  AiCompletionOptions,
  AiMessage,
  AiProvider,
  AiStreamChunk,
  AiTier,
} from './types/ai.types';
import { AiError } from './types/ai.types';
import { loadAiConfig, type AiConfig } from './config/ai.config';
import { OpenRouterProvider } from './providers/openrouter.provider';
import { RateLimiter } from './utils/rate-limiter';
import { modelsForTier, pickTier } from './utils/router';

interface RequestContext {
  userId: string;
  tenantId: string;
  conversationId: string;
  requestId: string;
  workspace?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new Logger('AiService');
  private cfg!: AiConfig;
  private providers = new Map<string, AiProvider>();
  private limiter!: RateLimiter;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.cfg = loadAiConfig();
    this.limiter = new RateLimiter(this.cfg);

    const or = new OpenRouterProvider(this.cfg);
    this.providers.set(or.name, or);

    // Startup diagnostics — no secrets, only reachability.
    if (!or.isConfigured()) {
      this.logger.warn(
        'OPENROUTER_API_KEY is missing — AI endpoints will return 503 until it is set.',
      );
    } else {
      this.logger.log(`AI providers ready: ${[...this.providers.keys()].join(', ')}`);
    }
  }

  /** Read-only view for the controller (never exposes secrets). */
  getPublicStatus() {
    const or = this.providers.get('openrouter');
    return {
      configured: !!or?.isConfigured(),
      defaultProvider: this.cfg.defaultProvider,
      streamingEnabled: this.cfg.enableStreaming,
    };
  }

  // ── Non-streaming path ────────────────────────────────────────────
  async chat(
    message: string,
    ctx: RequestContext,
    tierHint?: AiTier,
  ): Promise<AiCompletion & { tier: AiTier; conversationId: string }> {
    const tier = pickTier(message, tierHint);
    const messages: AiMessage[] = [{ role: 'user', content: message }];
    this.limiter.acquire(ctx.userId);
    const startedAt = new Date();
    let retries = 0;
    let lastErr: any;

    try {
      const models = modelsForTier(this.cfg, tier);
      const provider = this.providers.get(this.cfg.defaultProvider);
      if (!provider) throw new AiError('No AI provider configured.', 'provider-unavailable');

      for (const spec of models) {
        try {
          const options: AiCompletionOptions = {
            tier,
            model: spec.id,
            temperature: this.cfg.temperature,
            maxTokens: this.cfg.maxTokens,
            requestId: ctx.requestId,
            stream: false,
          };
          const res = await provider.complete(messages, options);
          this.limiter.recordTokens(ctx.userId, res.usage.totalTokens);
          await this.logSuccess(ctx, tier, res, retries, startedAt);
          return { ...res, tier, conversationId: ctx.conversationId };
        } catch (e: any) {
          lastErr = e;
          retries += 1;
          if (e instanceof AiError && (e.kind === 'unauthorized' || e.kind === 'rate-limit')) {
            // Don't burn through other models on auth/rate errors.
            break;
          }
          this.logger.warn(
            `[${ctx.requestId}] model ${spec.id} failed (${e?.message}); trying next`,
          );
        }
      }
      await this.logFailure(ctx, tier, lastErr, retries, startedAt);
      throw lastErr instanceof AiError
        ? lastErr
        : new AiError('AI request failed.', 'unknown');
    } finally {
      this.limiter.release(ctx.userId);
    }
  }

  // ── Streaming path ───────────────────────────────────────────────
  async *chatStream(
    message: string,
    ctx: RequestContext,
    tierHint?: AiTier,
  ): AsyncGenerator<AiStreamChunk & { tier: AiTier; conversationId: string }, void, unknown> {
    if (!this.cfg.enableStreaming) {
      // Fallback: emit as a single chunk from the non-streaming path.
      const final = await this.chat(message, ctx, tierHint);
      yield {
        delta: final.content,
        done: true,
        final,
        tier: final.tier,
        conversationId: final.conversationId,
      };
      return;
    }

    const tier = pickTier(message, tierHint);
    const messages: AiMessage[] = [{ role: 'user', content: message }];
    this.limiter.acquire(ctx.userId);
    const startedAt = new Date();
    let retries = 0;
    let lastErr: any;

    try {
      const models = modelsForTier(this.cfg, tier);
      const provider = this.providers.get(this.cfg.defaultProvider);
      if (!provider) throw new AiError('No AI provider configured.', 'provider-unavailable');

      for (const spec of models) {
        try {
          const options: AiCompletionOptions = {
            tier,
            model: spec.id,
            temperature: this.cfg.temperature,
            maxTokens: this.cfg.maxTokens,
            requestId: ctx.requestId,
            stream: true,
          };
          let finalRes: AiCompletion | undefined;
          for await (const chunk of provider.stream(messages, options)) {
            if (chunk.done && chunk.final) finalRes = chunk.final;
            yield { ...chunk, tier, conversationId: ctx.conversationId };
          }
          if (finalRes) {
            this.limiter.recordTokens(ctx.userId, finalRes.usage.totalTokens);
            await this.logSuccess(ctx, tier, finalRes, retries, startedAt);
          }
          return;
        } catch (e: any) {
          lastErr = e;
          retries += 1;
          if (e instanceof AiError && (e.kind === 'unauthorized' || e.kind === 'rate-limit')) {
            break;
          }
          this.logger.warn(
            `[${ctx.requestId}] stream model ${spec.id} failed (${e?.message}); trying next`,
          );
        }
      }
      await this.logFailure(ctx, tier, lastErr, retries, startedAt);
      throw lastErr instanceof AiError ? lastErr : new AiError('AI stream failed.', 'unknown');
    } finally {
      this.limiter.release(ctx.userId);
    }
  }

  // ── Logging (persisted audit — no secrets, no raw prompt) ─────────
  private async logSuccess(
    ctx: RequestContext,
    tier: AiTier,
    res: AiCompletion,
    retryCount: number,
    startedAt: Date,
  ) {
    try {
      await (this.prisma as any).aiRequestLog?.create?.({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          conversationId: ctx.conversationId,
          requestId: ctx.requestId,
          workspace: ctx.workspace ?? null,
          tier,
          provider: res.provider,
          model: res.model,
          promptTokens: res.usage.promptTokens,
          completionTokens: res.usage.completionTokens,
          totalTokens: res.usage.totalTokens,
          costUsd: res.costUsd,
          latencyMs: res.latencyMs,
          success: true,
          retryCount,
          errorMessage: null,
          startedAt,
          finishedAt: new Date(),
        },
      });
    } catch (e) {
      // Never let audit logging break the request path.
      this.logger.warn(`Audit log failed: ${(e as any)?.message}`);
    }
  }

  private async logFailure(
    ctx: RequestContext,
    tier: AiTier,
    err: any,
    retryCount: number,
    startedAt: Date,
  ) {
    try {
      await (this.prisma as any).aiRequestLog?.create?.({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          conversationId: ctx.conversationId,
          requestId: ctx.requestId,
          workspace: ctx.workspace ?? null,
          tier,
          provider: err?.provider ?? 'unknown',
          model: 'unknown',
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          latencyMs: Date.now() - startedAt.getTime(),
          success: false,
          retryCount,
          errorMessage: String(err?.message ?? err).slice(0, 500),
          startedAt,
          finishedAt: new Date(),
        },
      });
    } catch {
      // ignore
    }
  }

  /** Simple id factory the controller uses for both request + conversation. */
  static newId(): string {
    return randomUUID();
  }
}
