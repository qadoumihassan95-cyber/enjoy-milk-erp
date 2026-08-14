/**
 * Shared AI types. Kept intentionally provider-agnostic so we can add
 * OpenAI / Anthropic / Azure / LocalLLM providers later without changing
 * a single call site.
 *
 * NO provider-specific field names leak out of this file. Providers
 * adapt their own APIs to these shapes inside their implementation.
 */

export type AiTier = 'small' | 'medium' | 'premium';

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiCompletionOptions {
  /** Which routing tier the router picked for this request. */
  tier: AiTier;
  /** Concrete model id chosen from that tier's list. */
  model: string;
  temperature?: number;
  maxTokens?: number;
  /** Provider-agnostic idempotency-like id — always propagates as request id in logs. */
  requestId: string;
  /** If true, provider should return a stream; otherwise a single AiCompletion. */
  stream?: boolean;
}

export interface AiTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AiCompletion {
  /** Full assistant text. */
  content: string;
  usage: AiTokenUsage;
  /** Estimated USD cost — 0 when unknown. Providers compute this. */
  costUsd: number;
  /** Which model actually served the request (may differ from options.model on router-fallback). */
  model: string;
  /** Which provider served the request. */
  provider: string;
  /** Round-trip latency in ms. */
  latencyMs: number;
  /** Correlation id — same as the one passed in options.requestId. */
  requestId: string;
}

/** A single streamed chunk. */
export interface AiStreamChunk {
  /** Incremental text delta. */
  delta: string;
  /** Set only on the FINAL chunk with the same shape as AiCompletion. */
  done?: boolean;
  final?: AiCompletion;
}

/**
 * AI provider interface. Every provider (OpenRouter, OpenAI, Anthropic,
 * Azure, LocalLLM) implements ONLY this shape. The service and router
 * never import a concrete provider.
 */
export interface AiProvider {
  /** Human-readable provider name for logs and responses. */
  readonly name: string;

  /** Non-streaming completion. */
  complete(
    messages: AiMessage[],
    options: AiCompletionOptions,
  ): Promise<AiCompletion>;

  /** Streaming completion. Async-iterates chunks; final chunk carries `done: true` + `final`. */
  stream(
    messages: AiMessage[],
    options: AiCompletionOptions,
  ): AsyncIterable<AiStreamChunk>;

  /** True if the provider is currently usable (env vars present, etc.). */
  isConfigured(): boolean;
}

/** Rich error thrown to the controller. Never leaks provider internals. */
export class AiError extends Error {
  constructor(
    message: string,
    public readonly kind:
      | 'timeout'
      | 'rate-limit'
      | 'unauthorized'
      | 'provider-unavailable'
      | 'invalid-response'
      | 'unknown',
    public readonly provider?: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'AiError';
  }
}
