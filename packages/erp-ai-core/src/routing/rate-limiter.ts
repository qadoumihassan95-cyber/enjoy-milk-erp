/**
 * In-memory sliding-window rate limiter keyed by userId.
 * Enforces three limits:
 *   - requestsPerMinute
 *   - tokensPerMinute  (only spent tokens are counted; you must call
 *                        recordTokens(user, n) after a request finishes)
 *   - maxConcurrent    (increment / decrement around each request)
 *
 * Multi-instance deploys would want Redis; the interface here is small
 * so swapping later is trivial.
 */

import type { AiConfig } from '../config';
import { AiError } from '../types/ai.types';

interface Bucket {
  requests: number[];   // ms timestamps
  tokens: Array<{ at: number; n: number }>;
  inflight: number;
}

const WINDOW_MS = 60_000;

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  constructor(private readonly cfg: AiConfig) {}

  private get(userId: string): Bucket {
    let b = this.buckets.get(userId);
    if (!b) {
      b = { requests: [], tokens: [], inflight: 0 };
      this.buckets.set(userId, b);
    }
    return b;
  }

  private prune(b: Bucket, now: number) {
    const cutoff = now - WINDOW_MS;
    while (b.requests.length && b.requests[0] < cutoff) b.requests.shift();
    while (b.tokens.length && b.tokens[0].at < cutoff) b.tokens.shift();
  }

  /** Call BEFORE issuing the request. Throws AiError on breach. */
  acquire(userId: string) {
    const now = Date.now();
    const b = this.get(userId);
    this.prune(b, now);

    const limits = this.cfg.rateLimit;
    if (b.inflight >= limits.maxConcurrent) {
      throw new AiError(
        'Too many AI requests in flight for this user.',
        'rate-limit',
      );
    }
    if (b.requests.length >= limits.requestsPerMinute) {
      throw new AiError(
        'Too many AI requests per minute for this user.',
        'rate-limit',
      );
    }
    const spent = b.tokens.reduce((s, t) => s + t.n, 0);
    if (spent >= limits.tokensPerMinute) {
      throw new AiError(
        'Token quota exceeded for this user.',
        'rate-limit',
      );
    }
    b.requests.push(now);
    b.inflight += 1;
  }

  /** Call AFTER the request (success or fail). */
  release(userId: string) {
    const b = this.get(userId);
    if (b.inflight > 0) b.inflight -= 1;
  }

  /** Call once the completion is known so the token budget stays honest. */
  recordTokens(userId: string, totalTokens: number) {
    if (!totalTokens) return;
    this.get(userId).tokens.push({ at: Date.now(), n: totalTokens });
  }
}
