/**
 * Tool Registry — the ONLY place tools are registered.
 *
 * Modules add their tools here at bootstrap; the AI never sees the
 * concrete implementations, only the tool metadata.
 *
 * Also owns the "descriptor list" the model receives — this is the
 * text that ends up in the LLM's system prompt to let it know which
 * tools it may request. Phase 2 wires tool-calling; Phase 1 just
 * ships the plumbing.
 */

import type { AiTool } from './tool.types';

export class ToolRegistry {
  private byName = new Map<string, AiTool<any, any>>();

  register<T extends AiTool<any, any>>(tool: T): T {
    if (this.byName.has(tool.name)) {
      throw new Error(`Duplicate tool name: ${tool.name}`);
    }
    this.byName.set(tool.name, tool);
    return tool;
  }

  registerAll(tools: AiTool[]) {
    for (const t of tools) this.register(t);
  }

  get(name: string): AiTool | undefined {
    return this.byName.get(name);
  }

  list(filter: { module?: string } = {}): AiTool[] {
    const all = Array.from(this.byName.values());
    return filter.module ? all.filter((t) => t.module === filter.module) : all;
  }

  /**
   * Short JSON-safe descriptors the model sees — never expose the
   * handler function, but ship name / description / schemas.
   */
  describe(filter: { module?: string } = {}): Array<{
    name: string;
    description: string;
    module: string;
    inputSchema: any;
    outputSchema: any;
  }> {
    return this.list(filter).map((t) => ({
      name: t.name,
      description: t.description,
      module: t.module,
      inputSchema: t.inputSchema,
      outputSchema: t.outputSchema,
    }));
  }

  size(): number { return this.byName.size; }
  clear() { this.byName.clear(); }
}
