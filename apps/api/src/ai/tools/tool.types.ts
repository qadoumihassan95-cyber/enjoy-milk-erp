/**
 * AI Tool infrastructure — the ONLY authorized way for the AI to
 * touch ERP data. Phase 1 ships the registry + executor + permission
 * gate. Phase 2 will register real tools (inventory, production, …).
 *
 * The interface is intentionally small so it can also be exposed
 * verbatim over MCP later (`mcp-adapter.ts`) without redesign.
 */

import type { AiContext } from '../context/context-builder';

/** JSON Schema — kept as `any` to avoid a hard dep on ajv here. */
export type JsonSchema = any;

export interface ToolInput {
  ctx: AiContext;
  args: Record<string, unknown>;
  /** Correlation id — same as the AI request that triggered the tool. */
  requestId: string;
}

export interface ToolResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: {
    message: string;
    code:
      | 'permission-denied'
      | 'not-found'
      | 'invalid-input'
      | 'unavailable'
      | 'unknown';
  };
  /** Extra structured hints the AI can surface to the user. */
  meta?: Record<string, unknown>;
}

export interface AiTool<TArgs = any, TResult = any> {
  /** Stable identifier — `<module>.<action>` (e.g., 'inventory.stockOf'). */
  name: string;
  description: string;
  /** Which module owns the tool — used for filtering + docs. */
  module: string;
  /** Permission slugs the current user must have to invoke. Empty = anyone auth'd. */
  requiredPermissions: string[];
  /** JSON Schema for `args`. */
  inputSchema: JsonSchema;
  /** JSON Schema for `result.data`. */
  outputSchema: JsonSchema;
  /** Actual handler. NEVER touches the DB directly — calls existing services/prisma via constructor injection. */
  handle(input: ToolInput): Promise<ToolResult<TResult>>;
}

/** Permission gate contract — pluggable so tests can supply a stub. */
export interface PermissionGate {
  /**
   * Returns true if the user in `ctx` has ALL of the required
   * permission slugs. The real implementation consults the app's
   * existing RBAC (currently role + optional per-slug matrix).
   */
  allows(ctx: AiContext, requiredPermissions: string[]): boolean;
}
