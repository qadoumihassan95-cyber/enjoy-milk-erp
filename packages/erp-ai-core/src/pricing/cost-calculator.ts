/**
 * Cost calculator — pure function, no I/O. Uses the price table
 * embedded in AiConfig.tiers to convert token counts to USD.
 */

import type { AiConfig } from '../config';
import type { AiTokenUsage } from '../types/ai.types';

export function estimateCostUsd(
  cfg: AiConfig,
  model: string,
  usage: AiTokenUsage,
): number {
  for (const tier of Object.values(cfg.tiers)) {
    const spec = tier.find((m) => m.id === model);
    if (!spec) continue;
    const prompt = (usage.promptTokens / 1_000_000) * spec.promptUsdPerMTok;
    const completion = (usage.completionTokens / 1_000_000) * spec.completionUsdPerMTok;
    return Math.round((prompt + completion) * 1_000_000) / 1_000_000;
  }
  return 0;
}
