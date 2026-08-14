/**
 * AI Policies.
 *
 * A Policy is a small pure function that inspects a request+context
 * and can veto it, downgrade it, or amend it. Policies compose in
 * order — the first veto wins.
 *
 * This is the layer where all "configurable behaviour" lives:
 *   - maximum prompt / response size
 *   - allow-lists / deny-lists of models
 *   - streaming policy (on/off/per-tenant)
 *   - retry policy
 *   - fallback policy
 *   - safety policy
 *
 * Everything must be configurable without changing service code.
 */

import type { AiTier } from '../types/ai.types';
import type { RequestKind } from '../classifier/request-classifier';
import type { AiContext } from '../context/context-builder';

export interface PolicyConfig {
  maxPromptChars: number;
  maxResponseTokens: number;
  allowedModels?: string[];        // if set, only these ids may run
  disabledModels?: string[];       // hard deny
  allowedTools?: string[];         // reserved for Phase 2
  streaming: 'always' | 'never' | 'auto';
  retry: { maxAttempts: number; backoffMs: number };
  fallback: { withinTier: boolean; downgradeTier: boolean };
  safety: {
    forbidWriteOnUnsupervised: boolean;   // extra layer beyond RBAC
    maxToolCallsPerRequest: number;
  };
}

export const DEFAULT_POLICY: PolicyConfig = {
  maxPromptChars: 8000,
  maxResponseTokens: 2048,
  allowedModels: undefined,
  disabledModels: [],
  allowedTools: undefined,
  streaming: 'auto',
  retry: { maxAttempts: 2, backoffMs: 500 },
  fallback: { withinTier: true, downgradeTier: true },
  safety: { forbidWriteOnUnsupervised: false, maxToolCallsPerRequest: 5 },
};

export type PolicyDecision =
  | { kind: 'allow'; tier: AiTier }
  | { kind: 'downgrade'; from: AiTier; to: AiTier; reason: string }
  | { kind: 'deny'; reason: string; code: 'prompt-too-large' | 'model-disabled' | 'safety' };

export interface PolicyInput {
  message: string;
  requestedTier: AiTier;
  requestKind: RequestKind;
  chosenModel: string;
  ctx: AiContext;
}

/**
 * PolicyRegistry owns the effective per-tenant policy. Falls back to
 * DEFAULT_POLICY when a tenant hasn't overridden. Overrides can be
 * pushed at runtime (future admin UI).
 */
export class PolicyRegistry {
  private overrides = new Map<string, Partial<PolicyConfig>>();

  setForTenant(tenantId: string, overrides: Partial<PolicyConfig>) {
    this.overrides.set(tenantId, overrides);
  }

  effective(tenantId: string): PolicyConfig {
    const o = this.overrides.get(tenantId);
    if (!o) return DEFAULT_POLICY;
    return {
      ...DEFAULT_POLICY,
      ...o,
      retry: { ...DEFAULT_POLICY.retry, ...(o.retry ?? {}) },
      fallback: { ...DEFAULT_POLICY.fallback, ...(o.fallback ?? {}) },
      safety: { ...DEFAULT_POLICY.safety, ...(o.safety ?? {}) },
    };
  }

  /**
   * Evaluate policies for a specific request. Returns:
   *   - `allow`    → proceed with the requested tier
   *   - `downgrade`→ proceed but on a cheaper tier (budget-guard uses this)
   *   - `deny`     → reject the request (controller maps to 4xx/5xx)
   */
  evaluate(input: PolicyInput): PolicyDecision {
    const policy = this.effective(input.ctx.tenantId);

    if (input.message.length > policy.maxPromptChars) {
      return {
        kind: 'deny',
        reason: `Prompt exceeds max size (${input.message.length} > ${policy.maxPromptChars})`,
        code: 'prompt-too-large',
      };
    }
    if (policy.disabledModels?.includes(input.chosenModel)) {
      return { kind: 'deny', reason: `Model ${input.chosenModel} is disabled by policy.`, code: 'model-disabled' };
    }
    if (policy.allowedModels && !policy.allowedModels.includes(input.chosenModel)) {
      return { kind: 'deny', reason: `Model ${input.chosenModel} is not in the allow-list.`, code: 'model-disabled' };
    }
    return { kind: 'allow', tier: input.requestedTier };
  }
}
