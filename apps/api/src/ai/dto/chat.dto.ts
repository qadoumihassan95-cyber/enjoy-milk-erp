/**
 * Public DTOs for /api/ai/chat.
 * Kept as plain interfaces (no class-validator dep on this module) —
 * the controller does the shape checks manually so we stay compatible
 * with the rest of the codebase's minimal-DTO style.
 */

import type { AiTier } from '../types/ai.types';

export interface ChatRequestDto {
  /** The user's new message. Required, non-empty. */
  message: string;

  /**
   * Optional conversation id. If omitted a new one is generated and
   * returned. Memory / history is NOT stored server-side yet — that's
   * Phase 2. The id is purely correlation for now.
   */
  conversationId?: string;

  /**
   * Optional workspace hint — future integrations (Phase 2) will use
   * this to route ERP-context (e.g., 'inventory', 'production').
   * Ignored today.
   */
  workspace?: string;

  /** Free-form small metadata for logging (e.g., page url, feature). */
  metadata?: Record<string, string | number | boolean | null | undefined>;

  /**
   * Optional tier hint. The router MAY honor it but is free to
   * override. Users should NOT pick models — the router does.
   */
  tierHint?: AiTier;
}

export interface ChatResponseDto {
  conversationId: string;
  requestId: string;
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  costUsd: number;
  provider: string;
  model: string;
  latencyMs: number;
  tier: AiTier;
}
