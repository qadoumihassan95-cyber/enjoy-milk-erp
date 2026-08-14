/**
 * AiService — orchestrator for the AI platform.
 *
 * Public API (backward-compatible with Phase 1):
 *   getPublicStatus(), chat(), chatStream(), static newId()
 *
 * Internal pipeline (Phase 1 hardening):
 *
 *   ┌────────────┐   ┌──────────────┐   ┌────────────┐   ┌──────────┐
 *   │ Classifier │──▶│ PolicyRegistry│──▶│BudgetGuard │──▶│  Cache   │─┐
 *   └────────────┘   └──────────────┘   └────────────┘   └──────────┘ │
 *                                                                     ▼
 *                             ┌───────────────────────────────┐
 *                             │  Provider (health-aware pick) │
 *                             │  (fallback within tier)       │
 *                             └───────────────────────────────┘
 *                                             │
 *                                             ▼
 *                              RateLimiter → HealthMonitor → AiRequestLog
 *
 * Backward compatibility:
 *   - The controller/DTOs are unchanged.
 *   - Response shape unchanged.
 *   - New behaviour is ADDITIVE — classifier auto-picks tier
 *     (previous keyword router still consulted as a fallback),
 *     budget can force a downgrade, health picks the best model.
 *   - If no API key is configured, endpoints still 503 as before.
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
import { modelsForTier, pickTier as heuristicTier } from './utils/router';

import { classifyRequest, defaultTierFor, type ClassifiedRequest } from './classifier/request-classifier';
import { BudgetManager, DEFAULT_BUDGET_CONFIG } from './budget/budget-manager';
import { ModelHealthMonitor } from './health/model-health';
import { ResponseCache, CACHE_POLICIES, type CachePolicy } from './cache/response-cache';
import { PolicyRegistry, type PolicyConfig } from './policies/policies';
import { PromptManager, createDefaultPromptManager } from './prompts/prompt-manager';
import { ContextBuilder } from './context/context-builder';
import { ToolRegistry } from './tools/tool-registry';
import { ToolExecutor } from './tools/tool-executor';
import { DefaultPermissionGate } from './tools/permission-gate';
import type { AiMemoryBundle } from './memory/memory.types';
import { createNoopMemory } from './memory/noop-memory';
import type { AiContext } from './context/context-builder';

interface RequestContext {
  userId: string;
  tenantId: string;
  conversationId: string;
  requestId: string;
  workspace?: string;
  metadata?: Record<string, any>;
  role?: string;
  branchId?: string | null;
  locale?: 'ar' | 'en';
  /** Opt-in caching for read-only, non-personal prompts (Phase 1 default: off). */
  cache?: { policy: keyof typeof CACHE_POLICIES };
}

@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new Logger('AiService');

  // Core config + providers
  private cfg!: AiConfig;
  private providers = new Map<string, AiProvider>();
  private limiter!: RateLimiter;

  // New Phase-1-hardening infrastructure
  private budget!: BudgetManager;
  private health!: ModelHealthMonitor;
  private cache = new ResponseCache<AiCompletion>();
  private policies = new PolicyRegistry();
  private prompts: PromptManager = createDefaultPromptManager();
  private contextBuilder!: ContextBuilder;
  private toolRegistry = new ToolRegistry();
  private toolExecutor!: ToolExecutor;
  private memory: AiMemoryBundle = createNoopMemory();

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.cfg = loadAiConfig();
    this.limiter = new RateLimiter(this.cfg);
    this.budget = new BudgetManager(DEFAULT_BUDGET_CONFIG);
    this.health = new ModelHealthMonitor();
    this.contextBuilder = new ContextBuilder(
      process.env.APP_VERSION || 'dev',
      ['inventory', 'production', 'daily-production', 'customers', 'finance', 'employees', 'invoices', 'licenses'],
    );
    this.toolExecutor = new ToolExecutor(this.toolRegistry, new DefaultPermissionGate());

    const or = new OpenRouterProvider(this.cfg);
    this.providers.set(or.name, or);

    this.budget.onWarning((e) => {
      this.logger.warn(
        `[budget-warn] ${e.scope}/${e.window} ${e.keyId} at ${Math.round(e.fraction * 100)}% ` +
        `($${e.spent.toFixed(2)}/$${e.softLimit})`,
      );
    });

    if (!or.isConfigured()) {
      this.logger.warn('OPENROUTER_API_KEY missing — AI endpoints will 503 until set.');
    } else {
      this.logger.log(`AI providers ready: ${[...this.providers.keys()].join(', ')}`);
    }
  }

  // ── Public surface for tests + admin  ────────────────────────────
  getPublicStatus() {
    const or = this.providers.get('openrouter');
    return {
      configured: !!or?.isConfigured(),
      defaultProvider: this.cfg.defaultProvider,
      streamingEnabled: this.cfg.enableStreaming,
      toolsRegistered: this.toolRegistry.size(),
    };
  }
  /** Tests + admin ops. */
  getBudgetManager()   { return this.budget; }
  getHealthMonitor()   { return this.health; }
  getPolicyRegistry()  { return this.policies; }
  getPromptManager()   { return this.prompts; }
  getToolRegistry()    { return this.toolRegistry; }
  getToolExecutor()    { return this.toolExecutor; }
  getCache()           { return this.cache; }

  // ── Helpers ──────────────────────────────────────────────────────
  private buildContext(ctx: RequestContext): AiContext {
    return this.contextBuilder.build({
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      role: ctx.role ?? 'STAFF',
      branchId: ctx.branchId ?? null,
      workspace: ctx.workspace ?? null,
      locale: ctx.locale ?? 'ar',
      extra: ctx.metadata,
    });
  }

  private buildSystemMessages(aiCtx: AiContext): AiMessage[] {
    const sys = this.prompts.buildSystemPrompt({
      locale: aiCtx.locale,
      module: aiCtx.workspace ?? undefined,
      role: aiCtx.role,
    });
    const contextBlock = this.contextBuilder.render(aiCtx);
    return [{ role: 'system', content: `${sys}\n\n${contextBlock}` }];
  }

  private async classify(message: string): Promise<ClassifiedRequest> {
    return classifyRequest(message);
  }

  private chooseModel(tier: AiTier): { model: string; candidates: string[] } {
    const specs = modelsForTier(this.cfg, tier);
    const candidates = specs.map((s) => s.id);
    const pick = this.health.pick(candidates) ?? candidates[0];
    return { model: pick, candidates };
  }

  // ── Non-streaming path ───────────────────────────────────────────
  async chat(
    message: string,
    ctx: RequestContext,
    tierHint?: AiTier,
  ): Promise<AiCompletion & { tier: AiTier; conversationId: string }> {
    const aiCtx = this.buildContext(ctx);

    // 1. Classify → suggested tier (respect explicit hint if given)
    const classified = await this.classify(message);
    let tier: AiTier = tierHint ?? classified.suggestedTier ?? defaultTierFor(classified.kind);
    // Keep the legacy keyword router as an extra signal for backward compat
    const heuristic = heuristicTier(message, tierHint);
    if (heuristic === 'premium') tier = 'premium';   // never downgrade a heuristic-premium

    // 2. Policy evaluation (prompt size, allow/deny models)
    let { model, candidates } = this.chooseModel(tier);
    const decision = this.policies.evaluate({
      message, requestedTier: tier, requestKind: classified.kind, chosenModel: model, ctx: aiCtx,
    });
    if (decision.kind === 'deny') {
      throw new AiError(decision.reason, decision.code === 'prompt-too-large' ? 'invalid-response' : 'unauthorized');
    }

    // 3. Budget guard (may force downgrade)
    const budget = this.budget.check(
      { tenantId: ctx.tenantId, userId: ctx.userId, workspace: ctx.workspace ?? null },
      tier,
    );
    if (budget.kind === 'deny') {
      throw new AiError(budget.reason, 'rate-limit');
    }
    if (budget.kind === 'downgrade') {
      this.logger.log(`[${ctx.requestId}] budget downgrade ${budget.from}→${budget.to} (${budget.scope})`);
      tier = budget.to;
      const next = this.chooseModel(tier);
      model = next.model;
      candidates = next.candidates;
    }

    // 4. Cache (opt-in — safe policies only)
    if (ctx.cache && CACHE_POLICIES[ctx.cache.policy]) {
      const policy: CachePolicy = CACHE_POLICIES[ctx.cache.policy];
      const key = ResponseCache.key(ctx.tenantId, policy.name, message);
      const cached = this.cache.get(key);
      if (cached) {
        this.logger.log(`[${ctx.requestId}] cache-hit ${policy.name}`);
        return { ...cached, tier, conversationId: ctx.conversationId };
      }
    }

    // 5. Rate limiter
    this.limiter.acquire(ctx.userId);
    const startedAt = new Date();
    let retries = 0;
    let lastErr: any;

    // 6. Provider call with fallback within tier (health-informed)
    const messages: AiMessage[] = [
      ...this.buildSystemMessages(aiCtx),
      { role: 'user', content: message },
    ];
    const provider = this.providers.get(this.cfg.defaultProvider);
    if (!provider) throw new AiError('No AI provider configured.', 'provider-unavailable');

    try {
      // Try health-picked model first, then remaining candidates in order.
      const ordered = [model, ...candidates.filter((m) => m !== model)];
      for (const m of ordered) {
        try {
          const options: AiCompletionOptions = {
            tier,
            model: m,
            temperature: this.cfg.temperature,
            maxTokens: this.cfg.maxTokens,
            requestId: ctx.requestId,
            stream: false,
          };
          const res = await provider.complete(messages, options);
          this.limiter.recordTokens(ctx.userId, res.usage.totalTokens);
          this.health.recordSuccess(res.model, res.latencyMs);
          this.budget.record(
            { tenantId: ctx.tenantId, userId: ctx.userId, workspace: ctx.workspace ?? null },
            res.costUsd,
          );
          if (ctx.cache && CACHE_POLICIES[ctx.cache.policy]) {
            const policy: CachePolicy = CACHE_POLICIES[ctx.cache.policy];
            this.cache.set(ResponseCache.key(ctx.tenantId, policy.name, message), res, policy);
          }
          await this.logSuccess(ctx, tier, res, retries, startedAt);
          return { ...res, tier, conversationId: ctx.conversationId };
        } catch (e: any) {
          lastErr = e;
          retries += 1;
          this.health.recordFailure(m, {
            timedOut: e instanceof AiError && e.kind === 'timeout',
          });
          if (e instanceof AiError && (e.kind === 'unauthorized' || e.kind === 'rate-limit')) break;
          this.logger.warn(`[${ctx.requestId}] model ${m} failed (${e?.message}); trying next`);
        }
      }
      await this.logFailure(ctx, tier, lastErr, retries, startedAt);
      throw lastErr instanceof AiError ? lastErr : new AiError('AI request failed.', 'unknown');
    } finally {
      this.limiter.release(ctx.userId);
    }
  }

  // ── Streaming path ────────────────────────────────────────────────
  async *chatStream(
    message: string,
    ctx: RequestContext,
    tierHint?: AiTier,
  ): AsyncGenerator<AiStreamChunk & { tier: AiTier; conversationId: string }, void, unknown> {
    if (!this.cfg.enableStreaming) {
      const final = await this.chat(message, ctx, tierHint);
      yield { delta: final.content, done: true, final, tier: final.tier, conversationId: final.conversationId };
      return;
    }
    const aiCtx = this.buildContext(ctx);
    const classified = await this.classify(message);
    let tier: AiTier = tierHint ?? classified.suggestedTier ?? defaultTierFor(classified.kind);
    const heuristic = heuristicTier(message, tierHint);
    if (heuristic === 'premium') tier = 'premium';

    let { model, candidates } = this.chooseModel(tier);
    const decision = this.policies.evaluate({
      message, requestedTier: tier, requestKind: classified.kind, chosenModel: model, ctx: aiCtx,
    });
    if (decision.kind === 'deny') {
      throw new AiError(decision.reason, decision.code === 'prompt-too-large' ? 'invalid-response' : 'unauthorized');
    }
    const budget = this.budget.check(
      { tenantId: ctx.tenantId, userId: ctx.userId, workspace: ctx.workspace ?? null },
      tier,
    );
    if (budget.kind === 'deny') throw new AiError(budget.reason, 'rate-limit');
    if (budget.kind === 'downgrade') {
      tier = budget.to;
      const next = this.chooseModel(tier);
      model = next.model;
      candidates = next.candidates;
    }

    this.limiter.acquire(ctx.userId);
    const startedAt = new Date();
    let retries = 0;
    let lastErr: any;

    const messages: AiMessage[] = [
      ...this.buildSystemMessages(aiCtx),
      { role: 'user', content: message },
    ];
    const provider = this.providers.get(this.cfg.defaultProvider);
    if (!provider) throw new AiError('No AI provider configured.', 'provider-unavailable');

    try {
      const ordered = [model, ...candidates.filter((m) => m !== model)];
      for (const m of ordered) {
        try {
          const options: AiCompletionOptions = {
            tier, model: m,
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
            this.health.recordSuccess(finalRes.model, finalRes.latencyMs);
            this.budget.record(
              { tenantId: ctx.tenantId, userId: ctx.userId, workspace: ctx.workspace ?? null },
              finalRes.costUsd,
            );
            await this.logSuccess(ctx, tier, finalRes, retries, startedAt);
          }
          return;
        } catch (e: any) {
          lastErr = e;
          retries += 1;
          this.health.recordFailure(m, {
            timedOut: e instanceof AiError && e.kind === 'timeout',
          });
          if (e instanceof AiError && (e.kind === 'unauthorized' || e.kind === 'rate-limit')) break;
          this.logger.warn(`[${ctx.requestId}] stream model ${m} failed (${e?.message}); trying next`);
        }
      }
      await this.logFailure(ctx, tier, lastErr, retries, startedAt);
      throw lastErr instanceof AiError ? lastErr : new AiError('AI stream failed.', 'unknown');
    } finally {
      this.limiter.release(ctx.userId);
    }
  }

  // ── Audit log — no prompt/response text, no secrets ──────────────
  private async logSuccess(ctx: RequestContext, tier: AiTier, res: AiCompletion, retryCount: number, startedAt: Date) {
    try {
      await (this.prisma as any).aiRequestLog?.create?.({
        data: {
          tenantId: ctx.tenantId, userId: ctx.userId,
          conversationId: ctx.conversationId, requestId: ctx.requestId,
          workspace: ctx.workspace ?? null, tier,
          provider: res.provider, model: res.model,
          promptTokens: res.usage.promptTokens,
          completionTokens: res.usage.completionTokens,
          totalTokens: res.usage.totalTokens,
          costUsd: res.costUsd, latencyMs: res.latencyMs,
          success: true, retryCount, errorMessage: null,
          startedAt, finishedAt: new Date(),
        },
      });
    } catch (e) {
      this.logger.warn(`Audit log failed: ${(e as any)?.message}`);
    }
  }

  private async logFailure(ctx: RequestContext, tier: AiTier, err: any, retryCount: number, startedAt: Date) {
    try {
      await (this.prisma as any).aiRequestLog?.create?.({
        data: {
          tenantId: ctx.tenantId, userId: ctx.userId,
          conversationId: ctx.conversationId, requestId: ctx.requestId,
          workspace: ctx.workspace ?? null, tier,
          provider: err?.provider ?? 'unknown', model: 'unknown',
          promptTokens: 0, completionTokens: 0, totalTokens: 0,
          costUsd: 0, latencyMs: Date.now() - startedAt.getTime(),
          success: false, retryCount,
          errorMessage: String(err?.message ?? err).slice(0, 500),
          startedAt, finishedAt: new Date(),
        },
      });
    } catch { /* never let audit break the pipeline */ }
  }

  static newId(): string { return randomUUID(); }
}
