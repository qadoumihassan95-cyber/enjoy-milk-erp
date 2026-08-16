/**
 * AI Memory — INTERFACES ONLY (no implementation in Phase 1).
 *
 * These types are the extension points every Phase-2 memory strategy
 * will implement. The AiService references the interface, not any
 * concrete class, so switching from NoopMemory → Postgres → Redis
 * later requires zero changes to callers.
 *
 * Five memory kinds — each isolated so they can be swapped
 * independently:
 *   ConversationMemory — turn-by-turn chat history per conversationId
 *   ErpContextMemory   — computed ERP facts (last invoice #, top SKU)
 *   UserPreferenceMemory — language, verbosity, preferred report style
 *   WorkspaceMemory    — module-scoped notes ("we are in Q1 planning")
 *   TenantMemory       — company-wide facts (mission, glossary)
 */

import type { AiContext } from '../context/context-builder';
import type { AiMessage } from '../types/ai.types';

export interface ConversationTurn {
  role: 'user' | 'assistant' | 'system';
  content: string;
  ts: number;
  toolCalls?: Array<{ name: string; args: any; result?: any }>;
}

export interface ConversationMemory {
  append(conversationId: string, turn: ConversationTurn): Promise<void>;
  recent(conversationId: string, limit: number): Promise<ConversationTurn[]>;
  toMessages(conversationId: string, limit: number): Promise<AiMessage[]>;
  clear(conversationId: string): Promise<void>;
}

export interface KeyValueMemory {
  get(scopeKey: string, key: string): Promise<unknown | undefined>;
  set(scopeKey: string, key: string, value: unknown, ttlMs?: number): Promise<void>;
  delete(scopeKey: string, key: string): Promise<void>;
  list(scopeKey: string): Promise<Record<string, unknown>>;
}

export type ErpContextMemory   = KeyValueMemory;
export type UserPreferenceMemory = KeyValueMemory;
export type WorkspaceMemory    = KeyValueMemory;
export type TenantMemory       = KeyValueMemory;

/**
 * Bundle every memory an AI call may reach. Passing a single object
 * keeps the AiService signature small even as memory kinds grow.
 */
export interface AiMemoryBundle {
  conversation: ConversationMemory;
  erp: ErpContextMemory;
  user: UserPreferenceMemory;
  workspace: WorkspaceMemory;
  tenant: TenantMemory;
}

/**
 * Helper: derive stable scope keys from context. Concrete stores use
 * these to shard by tenant / user / workspace without every caller
 * re-constructing the keys.
 */
export function scopeKeys(ctx: AiContext) {
  return {
    tenant: `t:${ctx.tenantId}`,
    user: `u:${ctx.tenantId}:${ctx.userId}`,
    workspace: `w:${ctx.tenantId}:${ctx.workspace ?? '_global'}`,
    erp: `e:${ctx.tenantId}`,
  };
}
