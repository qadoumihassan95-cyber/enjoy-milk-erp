/**
 * Tool Executor — the single choke point that runs a tool.
 *
 * Responsibilities:
 *   · Look up the tool by name.
 *   · Enforce RBAC via the injected PermissionGate (never bypasses the
 *     ERP's existing rules).
 *   · Validate `args` shape (light JSON-Schema-lite — a hard dep on
 *     ajv is deferred to Phase 2 when tools land for real).
 *   · Run the handler and normalize any throw into a safe ToolResult.
 *
 * The AI service can call `execute()` once per tool decision. Nothing
 * else in the codebase is allowed to run a tool — that keeps auditing
 * simple and prevents future modules from bypassing the gate.
 */

import type { ToolRegistry } from './tool-registry';
import type { AiTool, PermissionGate, ToolInput, ToolResult } from './tool.types';
import type { AiContext } from '../context/context-builder';

export interface ExecuteInput {
  toolName: string;
  args: Record<string, unknown>;
  ctx: AiContext;
  requestId: string;
}

export class ToolExecutor {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly gate: PermissionGate,
  ) {}

  /** Very-lightweight schema check — enough for Phase 1 tests. */
  private validate(tool: AiTool, args: Record<string, unknown>): string | null {
    const schema = tool.inputSchema;
    if (!schema || typeof schema !== 'object') return null;
    const required: string[] = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (!(key in args)) return `Missing required field: ${key}`;
    }
    return null;
  }

  async execute(input: ExecuteInput): Promise<ToolResult> {
    const tool = this.registry.get(input.toolName);
    if (!tool) {
      return { ok: false, error: { code: 'not-found', message: `Tool not found: ${input.toolName}` } };
    }
    if (!this.gate.allows(input.ctx, tool.requiredPermissions)) {
      return { ok: false, error: { code: 'permission-denied', message: 'ليست لديك صلاحية لهذه العملية.' } };
    }
    const badArg = this.validate(tool, input.args);
    if (badArg) {
      return { ok: false, error: { code: 'invalid-input', message: badArg } };
    }
    const ti: ToolInput = { ctx: input.ctx, args: input.args, requestId: input.requestId };
    try {
      return await tool.handle(ti);
    } catch (e: any) {
      return {
        ok: false,
        error: {
          code: 'unknown',
          message: String(e?.message ?? 'Tool execution failed'),
        },
      };
    }
  }
}
