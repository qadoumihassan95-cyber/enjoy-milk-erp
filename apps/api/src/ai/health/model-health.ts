/**
 * Model Health Monitor.
 *
 * Continuously tracks per-model:
 *   · success rate    (sliding window)
 *   · error rate
 *   · timeout frequency
 *   · avg latency (EWMA)
 *   · last-success timestamp
 *
 * The service asks `pick()` for the healthiest model out of a candidate
 * list — unhealthy models are demoted, quarantined (skipped for N min
 * after crossing an error threshold), and eventually promoted again as
 * their window rolls.
 *
 * Purely in-memory per-process for now. When we scale beyond one API
 * instance, back this with a shared store (Redis / Postgres) — the
 * public interface stays the same.
 */

export interface ModelHealthSnapshot {
  model: string;
  successRate: number;      // 0..1 over the sliding window
  errorRate: number;        // 0..1
  timeoutRate: number;      // 0..1
  avgLatencyMs: number;
  lastSuccessAt: number | null;
  isQuarantined: boolean;
  quarantineUntil: number | null;
  totalObservations: number;
}

export interface HealthConfig {
  windowSize: number;             // number of most-recent observations kept per model
  quarantineErrorRate: number;    // >= this after >= minObservations → quarantine
  minObservations: number;
  quarantineMs: number;
  latencyEwmaAlpha: number;       // 0..1 — new-sample weight for EWMA
}

export const DEFAULT_HEALTH_CONFIG: HealthConfig = {
  windowSize: 50,
  quarantineErrorRate: 0.5,
  minObservations: 8,
  quarantineMs: 5 * 60 * 1000,     // 5 min quarantine
  latencyEwmaAlpha: 0.3,
};

interface Sample {
  ok: boolean;
  timedOut: boolean;
  latencyMs: number;
}

interface ModelStats {
  samples: Sample[];
  avgLatency: number;
  lastSuccessAt: number | null;
  quarantineUntil: number | null;
}

export class ModelHealthMonitor {
  private stats = new Map<string, ModelStats>();

  constructor(private cfg: HealthConfig = DEFAULT_HEALTH_CONFIG) {}

  configure(overrides: Partial<HealthConfig>) {
    this.cfg = { ...this.cfg, ...overrides };
  }

  private get(model: string): ModelStats {
    let s = this.stats.get(model);
    if (!s) {
      s = { samples: [], avgLatency: 0, lastSuccessAt: null, quarantineUntil: null };
      this.stats.set(model, s);
    }
    return s;
  }

  recordSuccess(model: string, latencyMs: number) {
    const s = this.get(model);
    s.samples.push({ ok: true, timedOut: false, latencyMs });
    if (s.samples.length > this.cfg.windowSize) s.samples.shift();
    s.avgLatency = s.avgLatency === 0
      ? latencyMs
      : s.avgLatency + this.cfg.latencyEwmaAlpha * (latencyMs - s.avgLatency);
    s.lastSuccessAt = Date.now();
    // clear quarantine on any recovery
    if (s.quarantineUntil && Date.now() >= s.quarantineUntil) s.quarantineUntil = null;
  }

  recordFailure(model: string, opts: { timedOut?: boolean; latencyMs?: number } = {}) {
    const s = this.get(model);
    s.samples.push({ ok: false, timedOut: !!opts.timedOut, latencyMs: opts.latencyMs ?? 0 });
    if (s.samples.length > this.cfg.windowSize) s.samples.shift();
    // Check quarantine condition
    if (
      s.samples.length >= this.cfg.minObservations &&
      s.samples.filter((x) => !x.ok).length / s.samples.length >= this.cfg.quarantineErrorRate
    ) {
      s.quarantineUntil = Date.now() + this.cfg.quarantineMs;
    }
  }

  isAvailable(model: string): boolean {
    const s = this.stats.get(model);
    if (!s) return true;   // never seen → assume available
    return !(s.quarantineUntil && Date.now() < s.quarantineUntil);
  }

  snapshot(model: string): ModelHealthSnapshot {
    const s = this.stats.get(model);
    if (!s || s.samples.length === 0) {
      return {
        model, successRate: 1, errorRate: 0, timeoutRate: 0,
        avgLatencyMs: 0, lastSuccessAt: null,
        isQuarantined: false, quarantineUntil: null, totalObservations: 0,
      };
    }
    const total = s.samples.length;
    const success = s.samples.filter((x) => x.ok).length;
    const errors = total - success;
    const timeouts = s.samples.filter((x) => x.timedOut).length;
    return {
      model,
      successRate: success / total,
      errorRate: errors / total,
      timeoutRate: timeouts / total,
      avgLatencyMs: Math.round(s.avgLatency),
      lastSuccessAt: s.lastSuccessAt,
      isQuarantined: !!(s.quarantineUntil && Date.now() < s.quarantineUntil),
      quarantineUntil: s.quarantineUntil,
      totalObservations: total,
    };
  }

  /**
   * Pick the healthiest model out of the candidate list (in caller-
   * specified order = preference). Skips quarantined models. Returns
   * `null` if all candidates are quarantined (service falls back to
   * the first candidate anyway — a bad call is better than none).
   */
  pick(candidates: string[]): string | null {
    for (const m of candidates) {
      if (this.isAvailable(m)) return m;
    }
    return null;
  }
}
