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
 * Heuristics (tunable via env later):
 *   ≤ 40 chars                                                 → small
 *   contains keywords like 'analyze', 'summarize long', 'code review',
 *     '»', or is >800 chars                                    → premium
 *   otherwise                                                  → medium
 */

import type { AiConfig, AiModelSpec } from '../config/ai.config';
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
  if (m.length <= 40) return 'small';
  if (MEDIUM_KEYWORDS.some((k) => lower.includes(k.toLowerCase()))) return 'medium';
  return 'medium';
}

/** Ordered model list for a tier — first entry is preferred. */
export function modelsForTier(cfg: AiConfig, tier: AiTier): AiModelSpec[] {
  return cfg.tiers[tier] ?? [];
}
