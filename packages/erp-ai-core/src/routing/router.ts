/**
 * Automatic model routing.
 *
 * The FE does NOT pick models. This router looks at the user's message
 * (and optional tier hint from the DTO) and picks a routing tier —
 * `small`, `medium`, or `premium` — then hands back the tier's ordered
 * model list for the service to try in order (first success wins;
 * retry within tier on failure).
 *
 * Rules are intentionally conservative and cheap to run.
 * Heuristics run in this order (first match wins):
 *   1. explicit tierHint                                       → hint
 *   2. > 800 chars                                             → premium
 *   3. contains a PREMIUM keyword ('analyze', 'refactor', …)   → premium
 *   4. contains a MEDIUM keyword ('explain', 'why', 'اشرح', …) → medium
 *   5. ≤ 40 chars                                              → small
 *   6. otherwise                                               → medium
 *
 * Semantic keyword rules deliberately outrank the length shortcut —
 * a short "explain X" is still an explanation request, not a lookup.
 */

import type { AiConfig, AiModelSpec } from '../config';
import type { AiTier } from '../types/ai.types';

const PREMIUM_KEYWORDS = [
  // English
  'analyze', 'analysis', 'root cause', 'refactor', 'design', 'architecture',
  'code review', 'compare in depth', 'strategy', 'plan',
  // Arabic
  'حلّل', 'حلل', 'تحليل', 'راجع', 'مراجعة', 'خطّة', 'خطة', 'استراتيجية',
];

const MEDIUM_KEYWORDS = [
  'summarize', 'summary', 'explain', 'why', 'how do i', 'write',
  'اشرح', 'لخّص', 'لخص', 'اكتب', 'ملخص', 'كيف',
];

export function pickTier(userMessage: string, hint?: AiTier): AiTier {
  if (hint) return hint;
  const m = (userMessage || '').trim();
  const lower = m.toLowerCase();
  if (m.length > 800) return 'premium';
  if (PREMIUM_KEYWORDS.some((k) => lower.includes(k.toLowerCase()))) return 'premium';
  // Medium-intent keywords MUST beat the length shortcut — a concise
  // "اشرح كيف …" is still an explanation request, not a lookup.
  if (MEDIUM_KEYWORDS.some((k) => lower.includes(k.toLowerCase()))) return 'medium';
  if (m.length <= 40) return 'small';
  return 'medium';
}

/** Ordered model list for a tier — first entry is preferred. */
export function modelsForTier(cfg: AiConfig, tier: AiTier): AiModelSpec[] {
  return cfg.tiers[tier] ?? [];
}
