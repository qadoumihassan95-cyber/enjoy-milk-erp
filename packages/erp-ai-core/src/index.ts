/**
 * @qadoumi/erp-ai-core — public API.
 *
 * The only supported surface. Consuming apps import from
 * `@qadoumi/erp-ai-core` (never deep-import from subfolders unless
 * they need internal helpers). Anything not re-exported here is a
 * private implementation detail and may change without a major bump.
 */

// ── Core orchestrator + factory ──────────────────────────────────
export { AiCore, createAiCore } from './core/ai-core';
export type { AiCoreOptions, AiRequestContext } from './core/ai-core';

// ── Config ───────────────────────────────────────────────────────
export {
  loadAiConfig,
  type AiConfig,
  type AiModelSpec,
} from './config';

// ── Provider layer ───────────────────────────────────────────────
export { OpenRouterProvider } from './providers/openrouter.provider';
export type {
  AiProvider,
  AiMessage,
  AiCompletion,
  AiCompletionOptions,
  AiStreamChunk,
  AiTokenUsage,
  AiTier,
} from './types/ai.types';
export { AiError } from './types/ai.types';

// ── Routing / rate limiting ──────────────────────────────────────
export { pickTier, modelsForTier } from './routing/router';
export { RateLimiter } from './routing/rate-limiter';

// ── Classifier ───────────────────────────────────────────────────
export {
  classifyHeuristic,
  classifyRequest,
  defaultTierFor,
} from './classifier/request-classifier';
export type {
  RequestKind,
  ClassifiedRequest,
  LlmClassifierProbe,
} from './classifier/request-classifier';

// ── Prompt / Context ─────────────────────────────────────────────
export {
  PromptManager,
  createDefaultPromptManager,
} from './prompts/prompt-manager';
export type { Prompt, PromptScope, Locale, PromptComposeInput } from './prompts/prompt-manager';

export { ContextBuilder } from './context/context-builder';
export type { AiContext, ContextBuilderInput } from './context/context-builder';

// ── Policies ─────────────────────────────────────────────────────
export {
  PolicyRegistry,
  DEFAULT_POLICY,
} from './policies/policies';
export type {
  PolicyConfig,
  PolicyDecision,
  PolicyInput,
} from './policies/policies';

// ── Budget guard ─────────────────────────────────────────────────
export {
  BudgetManager,
  DEFAULT_BUDGET_CONFIG,
} from './budget/budget-manager';
export type {
  BudgetConfig,
  BudgetDecision,
  BudgetKey,
  BudgetWarningEvent,
  BudgetLimits,
  BudgetWindow,
} from './budget/budget-manager';

// ── Health monitor ───────────────────────────────────────────────
export {
  ModelHealthMonitor,
  DEFAULT_HEALTH_CONFIG,
} from './health/model-health';
export type { HealthConfig, ModelHealthSnapshot } from './health/model-health';

// ── Cache ────────────────────────────────────────────────────────
export { ResponseCache, CACHE_POLICIES } from './cache/response-cache';
export type { CacheEntry, CachePolicy } from './cache/response-cache';

// ── Tools ────────────────────────────────────────────────────────
export { ToolRegistry } from './tools/tool-registry';
export { ToolExecutor } from './tools/tool-executor';
export { DefaultPermissionGate } from './tools/permission-gate';
export type {
  AiTool,
  ToolInput,
  ToolResult,
  PermissionGate,
  JsonSchema,
} from './tools/tool.types';

// ── Memory ───────────────────────────────────────────────────────
export { createNoopMemory } from './memory/noop-memory';
export type {
  AiMemoryBundle,
  ConversationMemory,
  ConversationTurn,
  KeyValueMemory,
  ErpContextMemory,
  UserPreferenceMemory,
  WorkspaceMemory,
  TenantMemory,
} from './memory/memory.types';
export { scopeKeys } from './memory/memory.types';

// ── MCP compatibility ────────────────────────────────────────────
export {
  toMcpToolDescriptors,
  handleMcpCall,
} from './mcp/mcp-adapter';
export type { McpToolDescriptor, McpCallRequest, McpCallResponse } from './mcp/mcp-adapter';

// ── Logging / audit ──────────────────────────────────────────────
export {
  ConsoleAuditLogger,
  NullAuditLogger,
} from './logging/audit-logger';
export type { AuditLogger, AiUsageEvent } from './logging/audit-logger';

// ── Cost calculator ──────────────────────────────────────────────
export { estimateCostUsd } from './pricing/cost-calculator';

// ── Errors (aliases for ergonomic consumer imports) ──────────────
export {
  AiTimeoutError,
  AiRateLimitError,
  AiBudgetExceededError,
  AiPermissionError,
  AiToolError,
  AiConfigurationError,
  AiUnavailableError,
  AiProviderError,
} from './errors/ai-errors';
