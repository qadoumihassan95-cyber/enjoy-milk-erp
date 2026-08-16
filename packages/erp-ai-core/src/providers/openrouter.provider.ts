/**
 * OpenRouter provider — the ONLY concrete provider today.
 *
 * OpenRouter's chat completions endpoint is OpenAI-compatible:
 *   POST {baseUrl}/chat/completions
 * with an `Authorization: Bearer <key>` header.
 *
 * We use native fetch (Node 18+) — no OpenAI SDK dep — so this stays
 * a self-contained module that will keep working across dep upgrades.
 */

import type {
  AiCompletion,
  AiCompletionOptions,
  AiMessage,
  AiProvider,
  AiStreamChunk,
  AiTokenUsage,
} from '../types/ai.types';
import { AiError } from '../types/ai.types';
import type { AiConfig, AiModelSpec } from '../config';

export class OpenRouterProvider implements AiProvider {
  readonly name = 'openrouter';

  constructor(private readonly cfg: AiConfig) {}

  isConfigured(): boolean {
    return !!this.cfg.openRouterApiKey && !!this.cfg.openRouterBaseUrl;
  }

  private modelSpec(modelId: string): AiModelSpec | null {
    for (const tier of Object.values(this.cfg.tiers)) {
      const hit = tier.find((m) => m.id === modelId);
      if (hit) return hit;
    }
    return null;
  }

  private estimateCost(model: string, usage: AiTokenUsage): number {
    const spec = this.modelSpec(model);
    if (!spec) return 0;
    const prompt = (usage.promptTokens / 1_000_000) * spec.promptUsdPerMTok;
    const completion = (usage.completionTokens / 1_000_000) * spec.completionUsdPerMTok;
    return Math.round((prompt + completion) * 1_000_000) / 1_000_000;
  }

  private headers(): Record<string, string> {
    if (!this.cfg.openRouterApiKey) {
      throw new AiError(
        'OpenRouter API key is not configured (OPENROUTER_API_KEY missing).',
        'unauthorized',
        this.name,
      );
    }
    return {
      Authorization: `Bearer ${this.cfg.openRouterApiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': this.cfg.appReferer,
      'X-Title': this.cfg.appName,
    };
  }

  private buildBody(
    messages: AiMessage[],
    options: AiCompletionOptions,
    stream: boolean,
  ) {
    return {
      model: options.model,
      messages,
      temperature: options.temperature ?? this.cfg.temperature,
      max_tokens: options.maxTokens ?? this.cfg.maxTokens,
      stream,
    };
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: ctrl.signal });
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        throw new AiError('AI request timed out', 'timeout', this.name);
      }
      throw new AiError(
        `Network error contacting AI provider: ${String(e?.message ?? e)}`,
        'provider-unavailable',
        this.name,
      );
    } finally {
      clearTimeout(t);
    }
  }

  private classifyStatus(status: number, bodyText: string): AiError {
    if (status === 401 || status === 403) {
      return new AiError('AI provider rejected the API key.', 'unauthorized', this.name, status);
    }
    if (status === 429) {
      return new AiError('AI provider rate-limited the request.', 'rate-limit', this.name, status);
    }
    if (status >= 500) {
      return new AiError('AI provider is temporarily unavailable.', 'provider-unavailable', this.name, status);
    }
    return new AiError(
      `AI provider returned ${status}: ${bodyText.slice(0, 200)}`,
      'invalid-response',
      this.name,
      status,
    );
  }

  async complete(
    messages: AiMessage[],
    options: AiCompletionOptions,
  ): Promise<AiCompletion> {
    if (!this.isConfigured()) {
      throw new AiError('AI provider not configured.', 'unauthorized', this.name);
    }
    const start = Date.now();
    const res = await this.fetchWithTimeout(`${this.cfg.openRouterBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.buildBody(messages, options, false)),
    });
    const text = await res.text();
    if (!res.ok) throw this.classifyStatus(res.status, text);

    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new AiError('AI provider returned non-JSON.', 'invalid-response', this.name, res.status);
    }
    const content: string = json?.choices?.[0]?.message?.content ?? '';
    if (!content) {
      throw new AiError('AI provider returned an empty response.', 'invalid-response', this.name);
    }
    const usage: AiTokenUsage = {
      promptTokens: Number(json?.usage?.prompt_tokens ?? 0),
      completionTokens: Number(json?.usage?.completion_tokens ?? 0),
      totalTokens: Number(json?.usage?.total_tokens ?? 0),
    };
    const model: string = json?.model ?? options.model;
    return {
      content,
      usage,
      costUsd: this.estimateCost(model, usage),
      model,
      provider: this.name,
      latencyMs: Date.now() - start,
      requestId: options.requestId,
    };
  }

  async *stream(
    messages: AiMessage[],
    options: AiCompletionOptions,
  ): AsyncGenerator<AiStreamChunk, void, unknown> {
    if (!this.isConfigured()) {
      throw new AiError('AI provider not configured.', 'unauthorized', this.name);
    }
    const start = Date.now();
    const res = await this.fetchWithTimeout(`${this.cfg.openRouterBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.buildBody(messages, options, true)),
    });
    if (!res.ok || !res.body) {
      const t = await res.text().catch(() => '');
      throw this.classifyStatus(res.status, t);
    }

    // SSE parse: OpenRouter sends `data: {...}\n\n` frames, terminated by `data: [DONE]`.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    let full = '';
    let usage: AiTokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let modelSeen: string = options.model;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffered.indexOf('\n\n')) !== -1) {
        const frame = buffered.slice(0, idx);
        buffered = buffered.slice(idx + 2);
        for (const line of frame.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          let parsed: any;
          try { parsed = JSON.parse(payload); } catch { continue; }
          const delta: string = parsed?.choices?.[0]?.delta?.content ?? '';
          if (parsed?.model) modelSeen = parsed.model;
          if (parsed?.usage) {
            usage = {
              promptTokens: Number(parsed.usage.prompt_tokens ?? usage.promptTokens),
              completionTokens: Number(parsed.usage.completion_tokens ?? usage.completionTokens),
              totalTokens: Number(parsed.usage.total_tokens ?? usage.totalTokens),
            };
          }
          if (delta) {
            full += delta;
            yield { delta };
          }
        }
      }
    }

    // Final frame
    const final: AiCompletion = {
      content: full,
      usage,
      costUsd: this.estimateCost(modelSeen, usage),
      model: modelSeen,
      provider: this.name,
      latencyMs: Date.now() - start,
      requestId: options.requestId,
    };
    yield { delta: '', done: true, final };
  }
}
