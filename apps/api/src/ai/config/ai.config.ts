/**
 * Central AI configuration. Everything is env-driven so behaviour can
 * change per environment without a redeploy of code changes.
 *
 * NEVER read the API key at request time — it must live in memory here
 * only, never logged, never returned to the client.
 */

import type { AiTier } from '../types/ai.types';

export interface AiModelSpec {
  /** OpenRouter model id (e.g. `openai/gpt-4o-mini`). */
  id: string;
  /** Rough USD cost per 1M prompt tokens. Used for logging estimates. */
  promptUsdPerMTok: number;
  /** Rough USD cost per 1M completion tokens. */
  completionUsdPerMTok: number;
}

export interface AiConfig {
  /** OpenRouter API key — READ ONCE at startup, NEVER logged. */
  openRouterApiKey: string;
  openRouterBaseUrl: string;
  /** App name reported to OpenRouter for their leaderboards / attribution. */
  appName: string;
  /** Referer sent to OpenRouter (their attribution requirement). */
  appReferer: string;
  /** Which provider name to use by default. Room to add more later. */
  defaultProvider: string;
  /** Whether streaming is enabled globally. FE also checks. */
  enableStreaming: boolean;
  timeoutMs: number;
  maxRetries: number;
  /** Model tier lists — router picks per tier and falls back within a tier. */
  tiers: Record<AiTier, AiModelSpec[]>;
  /** Default temperature for chat completions. */
  temperature: number;
  /** Ceiling for max tokens per completion. */
  maxTokens: number;
  /** Rate limiting knobs (all per-user). */
  rateLimit: {
    requestsPerMinute: number;
    tokensPerMinute: number;
    maxConcurrent: number;
  };
}

function envInt(k: string, def: number): number {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && v > 0 ? v : def;
}
function envFloat(k: string, def: number): number {
  const v = Number(process.env[k]);
  return Number.isFinite(v) ? v : def;
}
function envBool(k: string, def: boolean): boolean {
  const v = String(process.env[k] ?? '').toLowerCase().trim();
  if (!v) return def;
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * Default tier lists. Order matters — first entry is preferred, later
 * entries are automatic fallbacks within the SAME tier if the first
 * fails. Prices are ballpark and only used for cost logging; refresh
 * them from OpenRouter's public pricing when it changes.
 */
const DEFAULT_TIERS: Record<AiTier, AiModelSpec[]> = {
  small: [
    { id: 'openai/gpt-4o-mini',        promptUsdPerMTok: 0.15, completionUsdPerMTok: 0.60 },
    { id: 'anthropic/claude-haiku-4.5',promptUsdPerMTok: 1.00, completionUsdPerMTok: 5.00 },
    { id: 'meta-llama/llama-3.1-8b-instruct', promptUsdPerMTok: 0.05, completionUsdPerMTok: 0.10 },
  ],
  medium: [
    { id: 'openai/gpt-4o',              promptUsdPerMTok: 2.50, completionUsdPerMTok: 10.00 },
    { id: 'anthropic/claude-sonnet-4',  promptUsdPerMTok: 3.00, completionUsdPerMTok: 15.00 },
  ],
  premium: [
    { id: 'anthropic/claude-opus-4',    promptUsdPerMTok: 15.0, completionUsdPerMTok: 75.00 },
    { id: 'openai/gpt-4o',              promptUsdPerMTok: 2.50, completionUsdPerMTok: 10.00 },
  ],
};

export function loadAiConfig(): AiConfig {
  return {
    openRouterApiKey: process.env.OPENROUTER_API_KEY ?? '',
    openRouterBaseUrl: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
    appName: process.env.AI_APP_NAME ?? 'Enjoy Milk ERP',
    appReferer: process.env.AI_APP_REFERER ?? 'https://enjoymilk-web.onrender.com',
    defaultProvider: process.env.AI_DEFAULT_PROVIDER ?? 'openrouter',
    enableStreaming: envBool('AI_ENABLE_STREAMING', true),
    timeoutMs: envInt('AI_TIMEOUT', 45_000),
    maxRetries: envInt('AI_MAX_RETRIES', 2),
    tiers: DEFAULT_TIERS,
    temperature: envFloat('AI_TEMPERATURE', 0.4),
    maxTokens: envInt('AI_MAX_TOKENS', 2048),
    rateLimit: {
      requestsPerMinute: envInt('AI_RATE_RPM', 60),
      tokensPerMinute: envInt('AI_RATE_TPM', 60_000),
      maxConcurrent: envInt('AI_RATE_CONCURRENT', 4),
    },
  };
}
