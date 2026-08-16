/**
 * MCP compatibility adapter — shape only, no runtime MCP dep.
 *
 * The Model Context Protocol (MCP) exposes tools to external LLM
 * clients over a well-defined JSON-RPC contract. When we later add a
 * real MCP server, it will consume THIS adapter's output rather than
 * touching the ToolRegistry directly. That way the registry stays
 * the single source of truth about what tools exist.
 *
 * Phase 1 delivers:
 *   · `toMcpToolDescriptors(registry)` — returns the exact JSON shape
 *     MCP servers publish (name / description / inputSchema).
 *   · `handleMcpCall(executor, req)` — a stub that maps the MCP call
 *     envelope to a ToolExecutor.execute() call and formats the reply
 *     back into an MCP-shaped response.
 *
 * We deliberately do NOT install the MCP SDK yet. When we do, only
 * `mcp-server.ts` (Phase 2) needs to wire this adapter into `Server`
 * from `@modelcontextprotocol/sdk`.
 */

import type { ToolRegistry } from '../tools/tool-registry';
import type { ToolExecutor } from '../tools/tool-executor';
import type { AiContext } from '../context/context-builder';

export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: any;   // MCP uses JSON Schema
}

export function toMcpToolDescriptors(registry: ToolRegistry): McpToolDescriptor[] {
  return registry.describe().map((d) => ({
    name: d.name,
    description: `[${d.module}] ${d.description}`,
    inputSchema: d.inputSchema,
  }));
}

export interface McpCallRequest {
  name: string;
  arguments: Record<string, unknown>;
  /** MCP uses opaque request ids — we forward as-is if present. */
  _meta?: { requestId?: string };
}

export interface McpCallResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/**
 * Bridge an MCP-shaped call into the ToolExecutor. Requires an
 * AiContext to enforce RBAC — MCP servers will typically extract this
 * from their own transport-level auth (Phase 2).
 */
export async function handleMcpCall(
  executor: ToolExecutor,
  ctx: AiContext,
  req: McpCallRequest,
): Promise<McpCallResponse> {
  const requestId = req._meta?.requestId ?? `mcp-${Date.now()}`;
  const result = await executor.execute({
    toolName: req.name,
    args: req.arguments ?? {},
    ctx,
    requestId,
  });
  if (!result.ok) {
    return {
      isError: true,
      content: [{ type: 'text', text: result.error?.message ?? 'Tool error' }],
    };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(result.data ?? null) }],
  };
}
