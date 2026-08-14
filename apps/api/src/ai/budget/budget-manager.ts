/**
 * AI Budget Manager.
 *
 * Two thresholds per dimension (tenant / user / workspace):
 *   softLimit  → auto-downgrade to cheaper tier when hit
 *   hardLimit  → reject new AI requests until the window rolls
 *
 * Also emits WARNING events when spend crosses 80% of softLimit — so
 * we can hook admin notifications (email/slack/telegram) later without
 * touching this file.
 *
 * Storage is intentionally pluggable. The default is an in-memory
 * sliding window (per process). Swap for a Postgres/Redis backend when
 * we scale beyond one API instance — the interface won't change.
 */

import type { AiTier } from '../types/ai.types';

export type BudgetWindow = 'daily' | 'monthly';

export interface BudgetLimits {
  soft: number;      // USD — downgrade at this
  hard: number;      // USD — reject at this
}

export interface BudgetConfig {
  tenant?: Partial<Record<BudgetWindow, BudgetLimits>>;
  user?:   Partial<Record<BudgetWindow, BudgetLimits>>;
  workspace?: Partial<Record<BudgetWindow, BudgetLimits>>;
  /** How to downgrade — one step by default. Keep as data so we can tune. */
  downgradeMap: Record<AiTier, AiTier>;
  warnAtFraction: number;  // 0.8 by default → warn at 80% of soft
}

export const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  tenant: {
    daily:   { soft: 10, hard: 25 },   // $10 soft, $25 hard per day
    monthly: { soft: 200, hard: 500 },
  },
  user: {
    daily:   { soft: 2,  hard: 5 },
    monthly: { soft: 40, hard: 100 },
  },
  workspace: {
    daily:   { soft: 5,  hard: 15 },
    monthly: { soft: 120, hard: 300 },
  },
  downgradeMap: { premium: 'medium', medium: 'small', small: 'small' },
  warnAtFraction: 0.8,
};

export type BudgetDecision =
  | { kind: 'ok' }
  | { kind: 'downgrade'; from: AiTier; to: AiTier; reason: string; scope: string }
  | { kind: 'deny'; reason: string; scope: string };

interface Spend { at: number; usd: number }

export interface BudgetKey {
  tenantId: string;
  userId?: string;
  workspace?: string | null;
}

export interface BudgetWarningEvent {
  scope: 'tenant' | 'user' | 'workspace';
  window: BudgetWindow;
  keyId: string;              // tenantId | userId | workspaceKey
  spent: number;
  softLimit: number;
  fraction: number;
}

const DAY_MS   = 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * DAY_MS;

export class BudgetManager {
  private spends: Record<string, Spend[]> = {};   // key = 'scope:window:id'
  private warnedKeys = new Set<string>();
  private listeners: Array<(e: BudgetWarningEvent) => void> = [];

  constructor(private cfg: BudgetConfig = DEFAULT_BUDGET_CONFIG) {}

  onWarning(fn: (e: BudgetWarningEvent) => void) {
    this.listeners.push(fn);
  }

  configure(overrides: Partial<BudgetConfig>) {
    this.cfg = { ...this.cfg, ...overrides };
  }

  private windowMs(w: BudgetWindow): number {
    return w === 'daily' ? DAY_MS : MONTH_MS;
  }

  private prune(list: Spend[], cutoff: number): Spend[] {
    return list.filter((s) => s.at >= cutoff);
  }

  private sumWindow(key: string, w: BudgetWindow): number {
    const now = Date.now();
    const cutoff = now - this.windowMs(w);
    const arr = this.prune(this.spends[key] ?? [], cutoff);
    this.spends[key] = arr;
    return arr.reduce((s, x) => s + x.usd, 0);
  }

  private evaluateScope(
    scope: 'tenant' | 'user' | 'workspace',
    id: string,
    tier: AiTier,
  ): BudgetDecision {
    const limits = this.cfg[scope];
    if (!limits) return { kind: 'ok' };
    for (const w of ['daily', 'monthly'] as BudgetWindow[]) {
      const cfg = limits[w];
      if (!cfg) continue;
      const key = `${scope}:${w}:${id}`;
      const spent = this.sumWindow(key, w);
      if (spent >= cfg.hard) {
        return { kind: 'deny', reason: `${scope} ${w} hard limit reached ($${cfg.hard})`, scope: `${scope}/${w}` };
      }
      if (spent >= cfg.soft) {
        const to = this.cfg.downgradeMap[tier];
        return {
          kind: 'downgrade',
          from: tier, to,
          reason: `${scope} ${w} soft limit reached ($${cfg.soft})`,
          scope: `${scope}/${w}`,
        };
      }
      // Warn once per window when we cross the fraction threshold.
      if (spent >= cfg.soft * this.cfg.warnAtFraction && !this.warnedKeys.has(key)) {
        this.warnedKeys.add(key);
        for (const fn of this.listeners) {
          try {
            fn({
              scope, window: w, keyId: id, spent, softLimit: cfg.soft,
              fraction: spent / cfg.soft,
            });
          } catch { /* never let a listener kill the request */ }
        }
      }
    }
    return { kind: 'ok' };
  }

  /**
   * Check every configured scope. Downgrade wins over ok; deny wins
   * over downgrade. The most-restrictive scope is returned.
   */
  check(k: BudgetKey, tier: AiTier): BudgetDecision {
    const decisions: BudgetDecision[] = [
      this.evaluateScope('tenant', k.tenantId, tier),
    ];
    if (k.userId) decisions.push(this.evaluateScope('user', k.userId, tier));
    if (k.workspace) {
      decisions.push(this.evaluateScope('workspace', `${k.tenantId}:${k.workspace}`, tier));
    }
    if (decisions.some((d) => d.kind === 'deny')) {
      return decisions.find((d) => d.kind === 'deny')!;
    }
    if (decisions.some((d) => d.kind === 'downgrade')) {
      return decisions.find((d) => d.kind === 'downgrade')!;
    }
    return { kind: 'ok' };
  }

  /** Call AFTER each successful request with actual USD cost. */
  record(k: BudgetKey, usd: number) {
    if (!usd || usd <= 0) return;
    const now = Date.now();
    const push = (key: string) => {
      (this.spends[key] ??= []).push({ at: now, usd });
    };
    for (const w of ['daily', 'monthly'] as BudgetWindow[]) {
      push(`tenant:${w}:${k.tenantId}`);
      if (k.userId) push(`user:${w}:${k.userId}`);
      if (k.workspace) push(`workspace:${w}:${k.tenantId}:${k.workspace}`);
    }
  }

  /** For diagnostics / future admin dashboard. */
  snapshot(k: BudgetKey) {
    const rows: any[] = [];
    for (const w of ['daily', 'monthly'] as BudgetWindow[]) {
      rows.push({ scope: 'tenant',    window: w, spent: this.sumWindow(`tenant:${w}:${k.tenantId}`, w) });
      if (k.userId) rows.push({ scope: 'user', window: w, spent: this.sumWindow(`user:${w}:${k.userId}`, w) });
      if (k.workspace) rows.push({ scope: 'workspace', window: w, spent: this.sumWindow(`workspace:${w}:${k.tenantId}:${k.workspace}`, w) });
    }
    return rows;
  }
}
