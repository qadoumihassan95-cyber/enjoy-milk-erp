/**
 * NoopMemory — the default Phase-1 implementation. Records nothing,
 * returns nothing. Satisfies the interface so AiService can wire
 * memory calls now and swap to a real store in Phase 2 without
 * touching the pipeline.
 */

import type {
  AiMemoryBundle,
  ConversationMemory,
  ConversationTurn,
  KeyValueMemory,
} from './memory.types';
import type { AiMessage } from '../types/ai.types';

class NoopConversationMemory implements ConversationMemory {
  async append(_c: string, _t: ConversationTurn): Promise<void> { /* no-op */ }
  async recent(_c: string, _l: number): Promise<ConversationTurn[]> { return []; }
  async toMessages(_c: string, _l: number): Promise<AiMessage[]> { return []; }
  async clear(_c: string): Promise<void> { /* no-op */ }
}

class NoopKeyValue implements KeyValueMemory {
  async get(_s: string, _k: string) { return undefined; }
  async set(_s: string, _k: string, _v: unknown, _t?: number) { /* no-op */ }
  async delete(_s: string, _k: string) { /* no-op */ }
  async list(_s: string) { return {}; }
}

export function createNoopMemory(): AiMemoryBundle {
  const kv = new NoopKeyValue();
  return {
    conversation: new NoopConversationMemory(),
    erp: kv,
    user: kv,
    workspace: kv,
    tenant: kv,
  };
}
