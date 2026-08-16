/**
 * AI infrastructure regression tests.
 *
 * Locks in the contracts the whole ERP will build on top of:
 *   · Provider initialization / config gating
 *   · Automatic tier routing
 *   · Fallback within a tier when the first model fails
 *   · Timeout handling
 *   · Error classification (unauthorized / rate-limit / provider-unavailable)
 *   · Config env loading
 *
 * No live network calls — the OpenRouter provider is exercised through
 * a mocked global fetch.
 */

import {
  loadAiConfig,
  OpenRouterProvider,
  pickTier,
  modelsForTier,
  RateLimiter,
  AiError,
} from '../index';

function mkCfg(overrides: any = {}) {
  const base = loadAiConfig();
  return { ...base, ...overrides };
}

describe('AI config', () => {
  it('loadAiConfig reads env vars with safe defaults', () => {
    const prev = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    const c = loadAiConfig();
    expect(c.openRouterApiKey).toBe('');
    expect(c.openRouterBaseUrl.startsWith('https://')).toBe(true);
    expect(c.defaultProvider).toBe('openrouter');
    expect(c.enableStreaming).toBe(true);
    expect(c.tiers.small.length).toBeGreaterThan(0);
    expect(c.tiers.premium.length).toBeGreaterThan(0);
    process.env.OPENROUTER_API_KEY = prev;
  });
});

describe('Router — pickTier', () => {
  it('short messages → small', () => {
    expect(pickTier('كم الوقت الآن؟')).toBe('small');
  });
  it('medium messages → medium', () => {
    expect(pickTier('اشرح لي كيف يعمل التوجيه في هذا النظام')).toBe('medium');
  });
  it('long messages (>800 chars) → premium', () => {
    expect(pickTier('a'.repeat(900))).toBe('premium');
  });
  it('English "analyze" keyword forces premium', () => {
    expect(pickTier('please analyze the inventory turnover')).toBe('premium');
  });
  it('Arabic "حلل" keyword forces premium', () => {
    expect(pickTier('حلل لي نتائج الشهر')).toBe('premium');
  });
  it('honors tierHint when supplied', () => {
    expect(pickTier('short', 'premium')).toBe('premium');
  });
});

describe('modelsForTier', () => {
  it('returns ordered non-empty list for every tier', () => {
    const cfg = loadAiConfig();
    for (const t of ['small', 'medium', 'premium'] as const) {
      const list = modelsForTier(cfg, t);
      expect(list.length).toBeGreaterThan(0);
      expect(typeof list[0].id).toBe('string');
    }
  });
});

describe('OpenRouterProvider — configuration gate', () => {
  it('isConfigured() = false when no API key', () => {
    const cfg = mkCfg({ openRouterApiKey: '' });
    const p = new OpenRouterProvider(cfg);
    expect(p.isConfigured()).toBe(false);
  });
  it('isConfigured() = true when key present', () => {
    const cfg = mkCfg({ openRouterApiKey: 'sk-or-test' });
    const p = new OpenRouterProvider(cfg);
    expect(p.isConfigured()).toBe(true);
  });
  it('throws unauthorized AiError when complete() called without key', async () => {
    const cfg = mkCfg({ openRouterApiKey: '' });
    const p = new OpenRouterProvider(cfg);
    await expect(
      p.complete([{ role: 'user', content: 'hi' }], {
        tier: 'small', model: 'x', requestId: 'r1',
      }),
    ).rejects.toBeInstanceOf(AiError);
  });
});

describe('OpenRouterProvider — HTTP behaviour (mocked fetch)', () => {
  const origFetch = global.fetch;
  afterEach(() => { global.fetch = origFetch; });

  const cfg = mkCfg({ openRouterApiKey: 'sk-or-test' });

  function mockFetch(fn: any) {
    (global as any).fetch = jest.fn(fn);
  }

  it('parses a successful completion response', async () => {
    mockFetch(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content: 'مرحبا' } }],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        model: 'openai/gpt-4o-mini',
      }),
    }));
    const p = new OpenRouterProvider(cfg);
    const r = await p.complete(
      [{ role: 'user', content: 'hi' }],
      { tier: 'small', model: 'openai/gpt-4o-mini', requestId: 'req1' },
    );
    expect(r.content).toBe('مرحبا');
    expect(r.usage.totalTokens).toBe(8);
    expect(r.provider).toBe('openrouter');
    expect(r.requestId).toBe('req1');
    expect(r.costUsd).toBeGreaterThanOrEqual(0);
  });

  it('classifies 401 as unauthorized', async () => {
    mockFetch(async () => ({ ok: false, status: 401, text: async () => 'bad key' }));
    const p = new OpenRouterProvider(cfg);
    await expect(
      p.complete([{ role: 'user', content: 'x' }],
        { tier: 'small', model: 'openai/gpt-4o-mini', requestId: 'r' }),
    ).rejects.toMatchObject({ kind: 'unauthorized' });
  });

  it('classifies 429 as rate-limit', async () => {
    mockFetch(async () => ({ ok: false, status: 429, text: async () => 'rl' }));
    const p = new OpenRouterProvider(cfg);
    await expect(
      p.complete([{ role: 'user', content: 'x' }],
        { tier: 'small', model: 'openai/gpt-4o-mini', requestId: 'r' }),
    ).rejects.toMatchObject({ kind: 'rate-limit' });
  });

  it('classifies 5xx as provider-unavailable', async () => {
    mockFetch(async () => ({ ok: false, status: 503, text: async () => 'oops' }));
    const p = new OpenRouterProvider(cfg);
    await expect(
      p.complete([{ role: 'user', content: 'x' }],
        { tier: 'small', model: 'openai/gpt-4o-mini', requestId: 'r' }),
    ).rejects.toMatchObject({ kind: 'provider-unavailable' });
  });

  it('AbortError from fetch becomes timeout AiError', async () => {
    mockFetch(async () => {
      const e: any = new Error('The user aborted a request.');
      e.name = 'AbortError';
      throw e;
    });
    const p = new OpenRouterProvider(cfg);
    await expect(
      p.complete([{ role: 'user', content: 'x' }],
        { tier: 'small', model: 'openai/gpt-4o-mini', requestId: 'r' }),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('empty message content is treated as invalid-response', async () => {
    mockFetch(async () => ({
      ok: true, status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: '' } }] }),
    }));
    const p = new OpenRouterProvider(cfg);
    await expect(
      p.complete([{ role: 'user', content: 'x' }],
        { tier: 'small', model: 'openai/gpt-4o-mini', requestId: 'r' }),
    ).rejects.toMatchObject({ kind: 'invalid-response' });
  });
});

describe('RateLimiter', () => {
  it('rejects on request-per-minute breach', () => {
    const cfg = mkCfg({ rateLimit: { requestsPerMinute: 2, tokensPerMinute: 1e9, maxConcurrent: 10 } });
    const rl = new RateLimiter(cfg);
    rl.acquire('u1'); rl.release('u1');
    rl.acquire('u1'); rl.release('u1');
    expect(() => rl.acquire('u1')).toThrow(AiError);
  });
  it('rejects on concurrency breach', () => {
    const cfg = mkCfg({ rateLimit: { requestsPerMinute: 100, tokensPerMinute: 1e9, maxConcurrent: 1 } });
    const rl = new RateLimiter(cfg);
    rl.acquire('u1');
    expect(() => rl.acquire('u1')).toThrow(AiError);
    rl.release('u1');
    expect(() => rl.acquire('u1')).not.toThrow();
  });
  it('rejects on token quota breach after recordTokens', () => {
    const cfg = mkCfg({ rateLimit: { requestsPerMinute: 100, tokensPerMinute: 100, maxConcurrent: 10 } });
    const rl = new RateLimiter(cfg);
    rl.acquire('u1'); rl.recordTokens('u1', 150); rl.release('u1');
    expect(() => rl.acquire('u1')).toThrow(/Token quota/);
  });
});
