/**
 * AI Response Cache.
 *
 * Cache-safe requests only. The caller MUST provide `cacheable: true`
 * AND opt into a specific policy (`policy`) — the cache itself does
 * NOT try to guess which requests are safe. This is deliberate: a
 * false positive here silently returns stale invoice/payroll data,
 * which is worse than a cache miss.
 *
 * Never cache anything that:
 *   · reads or writes user-specific mutable data (invoices, payroll,
 *     authentication, orders, inventory quantities)
 *   · depends on `now` or the current user's timezone
 *
 * Safe to cache:
 *   · Company / factory information
 *   · Static lookups (list of products, categories)
 *   · Non-personalized dashboard narratives (short TTL)
 *   · Frequently-requested help / documentation queries
 */

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface CachePolicy {
  ttlMs: number;
  /** Human-readable name for logs (e.g. 'company-info', 'help'). */
  name: string;
}

export class ResponseCache<T = unknown> {
  private store = new Map<string, CacheEntry<T>>();

  constructor(private readonly maxEntries: number = 500) {}

  /** Deterministic key from tenant + policy + message. Never includes user id — same message from any user in the same tenant reuses. */
  static key(tenantId: string, policyName: string, message: string): string {
    // Cheap hash — bad for adversarial cases, fine for cache keys.
    let h = 5381;
    for (let i = 0; i < message.length; i++) {
      h = ((h << 5) + h) ^ message.charCodeAt(i);
    }
    return `${tenantId}:${policyName}:${(h >>> 0).toString(36)}`;
  }

  get(key: string): T | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (Date.now() >= e.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return e.value;
  }

  set(key: string, value: T, policy: CachePolicy): void {
    if (this.store.size >= this.maxEntries) {
      // FIFO eviction — first inserted key.
      const first = this.store.keys().next().value as string | undefined;
      if (first) this.store.delete(first);
    }
    this.store.set(key, { value, expiresAt: Date.now() + policy.ttlMs });
  }

  invalidate(prefix: string): number {
    let n = 0;
    for (const k of Array.from(this.store.keys())) {
      if (k.startsWith(prefix)) {
        this.store.delete(k);
        n += 1;
      }
    }
    return n;
  }

  clear() { this.store.clear(); }
  size(): number { return this.store.size; }
}

/** Named policies — extendable. Add new ones as safe use cases appear. */
export const CACHE_POLICIES: Record<string, CachePolicy> = {
  companyInfo:   { ttlMs: 24 * 60 * 60_000, name: 'company-info' },
  staticLookup:  { ttlMs: 60 * 60_000,      name: 'static-lookup' },
  dashboard:     { ttlMs: 5 * 60_000,       name: 'dashboard-narrative' },
  help:          { ttlMs: 24 * 60 * 60_000, name: 'help' },
};
