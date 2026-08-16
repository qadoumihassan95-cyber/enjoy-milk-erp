/**
 * AiCore — the plain-TypeScript orchestrator that runs the full AI
 * request pipeline. NO framework dependencies (no NestJS decorators,
 * no Prisma, no Express). Consuming apps wrap this class inside their
 * own web-framework provider.
 *
 * Pipeline (each layer is swappable via constructor options):
 *   1. classify         (request kind + suggested tier)
 *   2. context envelope (identity / tenant / locale)
 *   3. policy           (max prompt / model allow-deny)
 *   4. budget guard     (soft downgrade / hard reject)
 *   5. response cache   (opt-in only)
 *   6. rate limiter     (RPM / TPM / concurrency)
 *   7. health-picked model → provider.complete/stream
 *      (fallback within tier)
 *   8. record success/failure into health monitor + budget
 *   9. audit logger      (usage event with tokens / cost / latency)
 *
 * The returned shape is a stable public contract; consuming apps can
 * wrap AiCore in a controller/route handler without changing their
 * response DTOs.
 */

import { randomUUID } from 'crypto';

import type {
  AiCompletion,
  AiCompletionOptions,
  AiMessage,
  AiProvider,
  AiStreamChunk,
  AiTier,
} from '../types/ai.types';
import { AiError } from '../types/ai.types';
import type { AiConfig } from '../config';
import { loadAiConfig } from '../config';
import { OpenRouterProvider } from '../providers/openrouter.provider';
import { RateLimiter } from '../routing/rate-limiter';
import { modelsForTier, pickTier as heuristicTier } from '../routing/router';

import {
  classifyRequest,
  defaultTierFor,
  type ClassifiedRequest,
  type LlmClassifierProbe,
} from '../classifier/request-classifier';
import { BudgetManager, DEFAULT_BUDGET_CONFIG, type BudgetConfig } from '../budget/budget-manager';
import { ModelHealthMonitor } from '../health/model-health';
import { ResponseCache, CACHE_POLICIES, type CachePolicy } from '../cache/response-cache';
import { PolicyRegistry } from '../policies/policies';
import { PromptManager, createDefaultPromptManager } from '../prompts/prompt-manager';
import { ContextBuilder, type AiContext } from '../context/context-builder';
import { ToolRegistry } from '../tools/tool-registry';
import { ToolExecutor } from '../tools/tool-executor';
import { DefaultPermissionGate } from '../tools/permission-gate';
import type { PermissionGate } from '../tools/tool.types';
import type { AiMemoryBundle } from '../memory/memory.types';
import { createNoopMemory } from '../memory/noop-memory';

import type { AuditLogger, AiUsageEvent } from '../logging/audit-logger';
import { ConsoleAuditLogger } from '../logging/audit-logger';

/**
 * Everything the app carries per-request. Framework-free — a Nest
 * controller extracts these from its own AuthenticatedUser; an
 * Express handler from req.user; a Next.js handler from its session.
 */
export interface AiRequestContext {
  userId: string;
  tenantId: string;
  conversationId: string;
  requestId: string;
  workspace?: string | null;
  metadata?: Record<string, any>;
  role?: string;
  branchId?: string | null;
  locale?: 'ar' | 'en';
  cache?: { policy: keyof typeof CACHE_POLICIES };
}

export interface AiCoreOptions {
  /** Full config. Pass one built by `loadAiConfig()` (env) or hand-crafted. */
  config?: AiConfig;
  /** Optional provider overrides. Default: OpenRouter from config. */
  providers?: AiProvider[];
  /** Where to persist usage events. Default: console. */
  auditLogger?: AuditLogger;
  /** RBAC bridge. Default: role-string gate. */
  permissionGate?: PermissionGate;
  /** Prompt registry. Default: safe defaults. */
  promptManager?: PromptManager;
  /** Context envelope config. */
  erpVersion?: string;
  enabledModules?: string[];
  defaultTimezone?: string;
  /** Budget knobs. Default: DEFAULT_BUDGET_CONFIG. */
  budget?: BudgetConfig;
  /** Health knobs. Left to default in the monitor. */
  healthMonitor?: ModelHealthMonitor;
  /** Tool registry. Consumers register their tools after construction. */
  toolRegistry?: ToolRegistry;
  /** Memory bundle. Default: noop. */
  memory?: AiMemoryBundle;
  /** Optional LLM-probe for borderline classifier cases. */
  classifierProbe?: LlmClassifierProbe;
}

export class AiCore {
  readonly cfg: AiConfig;
  readonly providers: Map<string, AiProvider>;
  readonly limiter: RateLimiter;
  readonly budget: BudgetManager;
  readonly health: ModelHealthMonitor;
  readonly cache: ResponseCache<AiCompletion>;
  readonly policies: PolicyRegistry;
  readonly prompts: PromptManager;
  readonly contextBuilder: ContextBuilder;
  readonly toolRegistry: ToolRegistry;
  readonly toolExecutor: ToolExecutor;
  readonly memory: AiMemoryBundle;
  readonly auditLogger: AuditLogger;
  private readonly classifierProbe?: LlmClassifierProbe;

  constructor(opts: AiCoreOptions = {}) {
    this.cfg = opts.config ?? loadAiConfig();
    this.limiter = new RateLimiter(this.cfg);
    this.budget = new BudgetManager(opts.budget ?? DEFAULT_BUDGET_CONFIG);
    this.health = opts.healthMonitor ?? new ModelHealthMonitor();
    this.cache = new ResponseCache<AiCompletion>();
    this.policies = new PolicyRegistry();
    this.prompts = opts.promptManager ?? createDefaultPromptManager();
    this.contextBuilder = new ContextBuilder(
      opts.erpVersion ?? 'dev',
      opts.enabledModules ?? [],
      opts.defaultTimezone ?? 'Asia/Amman',
    );
    this.toolRegistry = opts.toolRegistry ?? new ToolRegistry();
    this.toolExecutor = new ToolExecutor(
      this.toolRegistry,
      opts.permissionGate ?? new DefaultPermissionGate(),
    );
    this.memory = opts.memory ?? createNoopMemory();
    this.auditLogger = opts.auditLogger ?? new ConsoleAuditLogger();
    this.classifierProbe = opts.classifierProbe;

    this.providers = new Map();
    if (opts.providers && opts.providers.length) {
      for (const p of opts.providers) this.providers.set(p.name, p);
    } else {
      const or = new OpenRouterProvider(this.cfg);
      this.providers.set(or.name, or);
    }
  }

  getPublicStatus() {
    const defaultProvider = this.providers.get(this.cfg.defaultProvider);
    return {
      configured: !!defaultProvider?.isConfigured?.(),
      defaultProvider: this.cfg.defaultProvider,
      streamingEnabled: this.cfg.enableStreaming,
      toolsRegistered: this.toolRegistry.size(),
    };
  }

  static newId(): string { return randomUUID(); }

  // ── Internal helpers ────────────────────────────────────────────
  private buildContext(ctx: AiRequestContext): AiContext {
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
    return classifyRequest(message, this.classifierProbe);
  }

  private chooseModel(tier: AiTier): { model: string; candidates: string[] } {
    const specs = modelsForTier(this.cfg, tier);
    const candidates = specs.map((s) => s.id);
    const pick = this.health.pick(candidates) ?? candidates[0];
    return { model: pick, candidates };
  }

  private async writeAudit(event: AiUsageEvent) {
    try {
      await this.auditLogger.record(event);
    } catch { /* audit failures never break the pipeline */ }
  }

  // ── Non-streaming path ──────────────────────────────────────────
  async chat(
    message: string,
    ctx: AiRequestContext,
    tierHint?: AiTier,
  ): Promise<AiCompletion & { tier: AiTier; conversationId: string; classification: string }> {
    const aiCtx = this.buildContext(ctx);
    const classified = await this.classify(message);
    let tier: AiTier = tierHint ?? classified.suggestedTier ?? defaultTierFor(classified.kind);
    const heuristic = heuristicTier(message, tierHint);
    if (heuristic === 'premium') tier = 'premium';

    let { model, candidates } = this.chooseModel(tier);
    const policyDecision = this.policies.evaluate({
      message, requestedTier: tier, requestKind: classified.kind, chosenModel: model, ctx: aiCtx,
    });
    if (policyDecision.kind === 'deny') {
      throw new AiError(policyDecision.reason,
        policyDecision.code === 'prompt-too-large' ? 'invalid-response' : 'unauthorized');
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

    if (ctx.cache && CACHE_POLICIES[ctx.cache.policy]) {
      const policy: CachePolicy = CACHE_POLICIES[ctx.cache.policy];
      const key = ResponseCache.key(ctx.tenantId, policy.name, message);
      const cached = this.cache.get(key);
      if (cached) return { ...cached, tier, conversationId: ctx.conversationId, classification: classified.kind };
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
          await this.writeAudit({
            requestId: ctx.requestId,
            conversationId: ctx.conversationId,
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            workspace: ctx.workspace ?? null,
            tier,
            provider: res.provider, model: res.model,
            promptTokens: res.usage.promptTokens,
            completionTokens: res.usage.completionTokens,
            totalTokens: res.usage.totalTokens,
            costUsd: res.costUsd, latencyMs: res.latencyMs,
            success: true, retryCount: retries,
            classification: classified.kind,
            errorMessage: null,
            startedAt, finishedAt: new Date(),
          });
          return { ...res, tier, conversationId: ctx.conversationId, classification: classified.kind };
        } catch (e: any) {
          lastErr = e;
          retries += 1;
          this.health.recordFailure(m, {
            timedOut: e instanceof AiError && e.kind === 'timeout',
          });
          if (e instanceof AiError && (e.kind === 'unauthorized' || e.kind === 'rate-limit')) break;
        }
      }
      await this.writeAudit({
        requestId: ctx.requestId, conversationId: ctx.conversationId,
        tenantId: ctx.tenantId, userId: ctx.userId, workspace: ctx.workspace ?? null,
        tier, provider: lastErr?.provider ?? 'unknown', model: 'unknown',
        promptTokens: 0, completionTokens: 0, totalTokens: 0,
        costUsd: 0, latencyMs: Date.now() - startedAt.getTime(),
        success: false, retryCount: retries,
        classification: classified.kind,
        errorMessage: String(lastErr?.message ?? lastErr).slice(0, 500),
        startedAt, finishedAt: new Date(),
      });
      throw lastErr instanceof AiError ? lastErr : new AiError('AI request failed.', 'unknown');
    } finally {
      this.limiter.release(ctx.userId);
    }
  }

  // ── Streaming path ──────────────────────────────────────────────
  async *chatStream(
    message: string,
    ctx: AiRequestContext,
    tierHint?: AiTier,
  ): AsyncGenerator<AiStreamChunk & { tier: AiTier; conversationId: string; classification: string }, void, unknown> {
    if (!this.cfg.enableStreaming) {
      const final = await this.chat(message, ctx, tierHint);
      yield {
        delta: final.content, done: true, final,
        tier: final.tier, conversationId: final.conversationId,
        classification: final.classification,
      };
      return;
    }
    const aiCtx = this.buildContext(ctx);
    const classified = await this.classify(message);
    let tier: AiTier = tierHint ?? classified.suggestedTier ?? defaultTierFor(classified.kind);
    const heuristic = heuristicTier(message, tierHint);
    if (heuristic === 'premium') tier = 'premium';

    let { model, candidates } = this.chooseModel(tier);
    const policyDecision = this.policies.evaluate({
      message, requestedTier: tier, requestKind: classified.kind, chosenModel: model, ctx: aiCtx,
    });
    if (policyDecision.kind === 'deny') {
      throw new AiError(policyDecision.reason,
        policyDecision.code === 'prompt-too-large' ? 'invalid-response' : 'unauthorized');
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
            yield {
              ...chunk, tier, conversationId: ctx.conversationId,
              classification: classified.kind,
            };
          }
          if (finalRes) {
            this.limiter.recordTokens(ctx.userId, finalRes.usage.totalTokens);
            this.health.recordSuccess(finalRes.model, finalRes.latencyMs);
            this.budget.record(
              { tenantId: ctx.tenantId, userId: ctx.userId, workspace: ctx.workspace ?? null },
              finalRes.costUsd,
            );
            await this.writeAudit({
              requestId: ctx.requestId, conversationId: ctx.conversationId,
              tenantId: ctx.tenantId, userId: ctx.userId, workspace: ctx.workspace ?? null,
              tier, provider: finalRes.provider, model: finalRes.model,
              promptTokens: finalRes.usage.promptTokens,
              completionTokens: finalRes.usage.completionTokens,
              totalTokens: finalRes.usage.totalTokens,
              costUsd: finalRes.costUsd, latencyMs: finalRes.latencyMs,
              success: true, retryCount: retries,
              classification: classified.kind, errorMessage: null,
              startedAt, finishedAt: new Date(),
            });
          }
          return;
        } catch (e: any) {
          lastErr = e;
          retries += 1;
          this.health.recordFailure(m, {
            timedOut: e instanceof AiError && e.kind === 'timeout',
          });
          if (e instanceof AiError && (e.kind === 'unauthorized' || e.kind === 'rate-limit')) break;
        }
      }
      await this.writeAudit({
        requestId: ctx.requestId, conversationId: ctx.conversationId,
        tenantId: ctx.tenantId, userId: ctx.userId, workspace: ctx.workspace ?? null,
        tier, provider: lastErr?.provider ?? 'unknown', model: 'unknown',
        promptTokens: 0, completionTokens: 0, totalTokens: 0,
        costUsd: 0, latencyMs: Date.now() - startedAt.getTime(),
        success: false, retryCount: retries,
        classification: classified.kind,
        errorMessage: String(lastErr?.message ?? lastErr).slice(0, 500),
        startedAt, finishedAt: new Date(),
      });
      throw lastErr instanceof AiError ? lastErr : new AiError('AI stream failed.', 'unknown');
    } finally {
      this.limiter.release(ctx.userId);
    }
  }
}

/** Convenience factory — mostly for parity with named-export style. */
export function createAiCore(opts: AiCoreOptions = {}): AiCore {
  return new AiCore(opts);
}
