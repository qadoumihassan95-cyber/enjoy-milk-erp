/**
 * AI Request Classifier.
 *
 * Replaces the previous keyword-only router. The classifier decides
 * WHAT KIND of request this is; a separate mapping decides WHICH TIER
 * to run it on. This split matters because the two questions evolve
 * independently (a new "Tool Execution" kind may still map to `small`,
 * a new premium model may take everything expensive).
 *
 * Two-stage classification:
 *   1. Fast heuristic (~µs) — good enough for 90% of traffic and
 *      always runs. Never depends on the LLM.
 *   2. Optional LLM refinement — if we ever want the small model
 *      itself to disambiguate borderline cases. Left as an
 *      extension point via `LlmClassifierProbe` — not enabled by
 *      default so we don't pay a round-trip on every request.
 *
 * Providers, routing, budgets, and health monitoring all read the
 * `RequestKind` returned here.
 */

import type { AiTier } from '../types/ai.types';

export type RequestKind =
  | 'simple-lookup'      // "what's my balance?"
  | 'business-query'     // "how many cartons did we produce last week?"
  | 'analytical'         // "why is our waste up this month?"
  | 'long-reasoning'     // multi-step math / planning
  | 'complex-planning'   // "plan Q1 production for these SKUs"
  | 'content-generation' // "draft a supplier email"
  | 'tool-execution';    // AI needs to CALL a tool (Phase 2)

export interface ClassifiedRequest {
  kind: RequestKind;
  /** 0..1 confidence — cheap heuristic reports low confidence on borderline. */
  confidence: number;
  /** Which tier we recommend. Policy layer may override. */
  suggestedTier: AiTier;
  /** Reason text — logged, useful for tuning. Never shown to end user. */
  reason: string;
}

/** Interface for an optional LLM-based probe. Not called by default. */
export interface LlmClassifierProbe {
  classify(message: string): Promise<ClassifiedRequest>;
}

// ── Signal detectors ─────────────────────────────────────────────
const TOOL_HINTS = [
  'create', 'add', 'update', 'delete', 'change', 'set', 'schedule',
  'send', 'invoice', 'أنشئ', 'أضف', 'حدّث', 'حدث', 'احذف', 'أرسل',
];

const ANALYTICAL_HINTS = [
  'why', 'analyze', 'analysis', 'compare', 'root cause', 'trend',
  'anomaly', 'forecast', 'predict',
  'لماذا', 'حلل', 'حلّل', 'تحليل', 'قارن', 'توقع',
];

const PLANNING_HINTS = [
  'plan', 'strategy', 'roadmap', 'schedule for',
  'خطة', 'استراتيجية', 'خطّط',
];

const GENERATION_HINTS = [
  'write', 'draft', 'compose', 'email', 'letter', 'summary of',
  'اكتب', 'صيغ', 'مسودة', 'ايميل', 'ملخص',
];

const BUSINESS_QUERY_HINTS = [
  'how many', 'how much', 'total', 'sum', 'count', 'list', 'show me',
  'كم', 'إجمالي', 'اجمالي', 'مجموع', 'عرض', 'اعرض', 'قائمة',
];

function containsAny(low: string, list: readonly string[]): boolean {
  return list.some((w) => low.includes(w.toLowerCase()));
}

/** Default tier mapping — a policy can override this per tenant. */
export function defaultTierFor(kind: RequestKind): AiTier {
  switch (kind) {
    case 'simple-lookup':      return 'small';
    case 'business-query':     return 'small';
    case 'tool-execution':     return 'small';
    case 'content-generation': return 'medium';
    case 'analytical':         return 'premium';
    case 'long-reasoning':     return 'premium';
    case 'complex-planning':   return 'premium';
  }
}

export function classifyHeuristic(message: string): ClassifiedRequest {
  const m = (message || '').trim();
  const low = m.toLowerCase();
  const len = m.length;

  // Length-based cheap gates first — high confidence.
  if (len === 0) {
    return { kind: 'simple-lookup', confidence: 1, suggestedTier: 'small', reason: 'empty' };
  }
  if (len > 1200) {
    return {
      kind: 'long-reasoning', confidence: 0.9, suggestedTier: 'premium',
      reason: `length ${len} > 1200`,
    };
  }

  // Keyword signals — order matters (planning wins over analytical wins over generation…).
  if (containsAny(low, PLANNING_HINTS)) {
    return { kind: 'complex-planning', confidence: 0.75, suggestedTier: 'premium', reason: 'planning hint' };
  }
  if (containsAny(low, ANALYTICAL_HINTS)) {
    return { kind: 'analytical', confidence: 0.8, suggestedTier: 'premium', reason: 'analytical hint' };
  }
  if (containsAny(low, TOOL_HINTS) && len < 300) {
    return { kind: 'tool-execution', confidence: 0.7, suggestedTier: 'small', reason: 'imperative + short' };
  }
  if (containsAny(low, GENERATION_HINTS)) {
    return { kind: 'content-generation', confidence: 0.7, suggestedTier: 'medium', reason: 'generation hint' };
  }
  if (containsAny(low, BUSINESS_QUERY_HINTS)) {
    return { kind: 'business-query', confidence: 0.7, suggestedTier: 'small', reason: 'aggregation hint' };
  }

  // Fallback based on length.
  if (len <= 60)  return { kind: 'simple-lookup',  confidence: 0.6, suggestedTier: 'small',   reason: 'short fallback' };
  if (len <= 400) return { kind: 'business-query', confidence: 0.5, suggestedTier: 'small',  reason: 'medium fallback' };
  return { kind: 'analytical', confidence: 0.5, suggestedTier: 'premium', reason: 'long fallback' };
}

/**
 * Public entry point. If an LLM probe is supplied AND the heuristic is
 * low-confidence, delegate to the probe. Otherwise return the fast
 * heuristic result.
 */
export async function classifyRequest(
  message: string,
  probe?: LlmClassifierProbe,
): Promise<ClassifiedRequest> {
  const h = classifyHeuristic(message);
  if (h.confidence >= 0.7 || !probe) return h;
  try {
    const p = await probe.classify(message);
    return p;
  } catch {
    return h; // never fail the request because classification refinement failed
  }
}
