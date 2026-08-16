/**
 * Regression tests for Phase-1-hardening infrastructure:
 * classifier, budget, health monitor, cache, policies, tool
 * registry/executor/permissions, prompt manager, context builder,
 * MCP adapter shape, memory noop.
 *
 * All tests are self-contained — no live network, no DB.
 */

import {
  classifyHeuristic,
  classifyRequest,
  defaultTierFor,
  BudgetManager,
  DEFAULT_BUDGET_CONFIG,
  ModelHealthMonitor,
  ResponseCache,
  CACHE_POLICIES,
  PolicyRegistry,
  PromptManager,
  createDefaultPromptManager,
  ContextBuilder,
  ToolRegistry,
  ToolExecutor,
  DefaultPermissionGate,
  toMcpToolDescriptors,
  handleMcpCall,
  createNoopMemory,
} from '../index';
import type { AiTool } from '../index';

describe('Classifier', () => {
  it('empty → simple-lookup', () => {
    expect(classifyHeuristic('').kind).toBe('simple-lookup');
  });
  it('very long → long-reasoning', () => {
    expect(classifyHeuristic('a'.repeat(1300)).kind).toBe('long-reasoning');
  });
  it('planning keyword wins', () => {
    expect(classifyHeuristic('plan Q1 production strategy').kind).toBe('complex-planning');
  });
  it('analytical keyword → analytical', () => {
    expect(classifyHeuristic('why is our waste up this month?').kind).toBe('analytical');
  });
  it('imperative short → tool-execution', () => {
    expect(classifyHeuristic('add a new customer').kind).toBe('tool-execution');
  });
  it('Arabic حلل → analytical', () => {
    expect(classifyHeuristic('حلّل الأرقام لهذا الشهر').kind).toBe('analytical');
  });
  it('defaultTierFor maps every kind', () => {
    for (const k of ['simple-lookup','business-query','analytical','long-reasoning','complex-planning','content-generation','tool-execution'] as const) {
      expect(['small','medium','premium']).toContain(defaultTierFor(k));
    }
  });
  it('classifyRequest returns heuristic when no probe', async () => {
    const r = await classifyRequest('why is the sky blue?');
    expect(r.kind).toBe('analytical');
  });
});

describe('BudgetManager', () => {
  it('hard limit denies further spending', () => {
    const b = new BudgetManager({ ...DEFAULT_BUDGET_CONFIG,
      tenant: { daily: { soft: 100, hard: 1 } }, user: undefined, workspace: undefined });
    b.record({ tenantId: 't1' }, 1.5);
    const d = b.check({ tenantId: 't1' }, 'medium');
    expect(d.kind).toBe('deny');
  });
  it('soft limit downgrades tier', () => {
    const b = new BudgetManager({ ...DEFAULT_BUDGET_CONFIG,
      tenant: { daily: { soft: 1, hard: 100 } }, user: undefined, workspace: undefined });
    b.record({ tenantId: 't2' }, 1.5);
    const d = b.check({ tenantId: 't2' }, 'premium');
    expect(d.kind).toBe('downgrade');
    if (d.kind === 'downgrade') expect(d.to).toBe('medium');
  });
  it('warns at 80% of soft', () => {
    const b = new BudgetManager({ ...DEFAULT_BUDGET_CONFIG,
      tenant: { daily: { soft: 10, hard: 100 } }, user: undefined, workspace: undefined, warnAtFraction: 0.8 });
    let warned = 0;
    b.onWarning(() => { warned++; });
    b.record({ tenantId: 'tw' }, 8);
    b.check({ tenantId: 'tw' }, 'medium');
    expect(warned).toBe(1);
    b.check({ tenantId: 'tw' }, 'medium');
    expect(warned).toBe(1);
  });
});

describe('ModelHealthMonitor', () => {
  it('quarantines a model after enough failures', () => {
    const h = new ModelHealthMonitor({
      windowSize: 10, quarantineErrorRate: 0.5, minObservations: 4,
      quarantineMs: 60_000, latencyEwmaAlpha: 0.3,
    });
    for (let i = 0; i < 4; i++) h.recordFailure('m1');
    expect(h.isAvailable('m1')).toBe(false);
  });
  it('pick() skips quarantined models', () => {
    const h = new ModelHealthMonitor({
      windowSize: 10, quarantineErrorRate: 0.5, minObservations: 2,
      quarantineMs: 60_000, latencyEwmaAlpha: 0.3,
    });
    h.recordFailure('m1'); h.recordFailure('m1');
    expect(h.pick(['m1', 'm2'])).toBe('m2');
  });
  it('successful call clears quarantine after window expires', () => {
    const h = new ModelHealthMonitor({
      windowSize: 10, quarantineErrorRate: 0.5, minObservations: 2,
      quarantineMs: 1, latencyEwmaAlpha: 0.3,
    });
    h.recordFailure('m'); h.recordFailure('m');
    return new Promise((r) => setTimeout(r, 5)).then(() => {
      expect(h.isAvailable('m')).toBe(true);
    });
  });
});

describe('ResponseCache', () => {
  it('respects TTL', async () => {
    const c = new ResponseCache<string>();
    const key = ResponseCache.key('t', 'help', 'q');
    c.set(key, 'v', { ttlMs: 5, name: 'help' });
    expect(c.get(key)).toBe('v');
    await new Promise((r) => setTimeout(r, 10));
    expect(c.get(key)).toBeUndefined();
  });
  it('same message in same tenant hits the cache for both users', () => {
    const c = new ResponseCache<string>();
    const key = ResponseCache.key('t', 'company-info', 'about us?');
    c.set(key, 'v', CACHE_POLICIES.companyInfo);
    expect(c.get(key)).toBe('v');
  });
  it('invalidate by prefix', () => {
    const c = new ResponseCache<string>();
    c.set(ResponseCache.key('t', 'help', 'a'), '1', CACHE_POLICIES.help);
    c.set(ResponseCache.key('t', 'help', 'b'), '2', CACHE_POLICIES.help);
    expect(c.invalidate('t:help:')).toBe(2);
  });
});

describe('PolicyRegistry', () => {
  const ctx: any = { userId: 'u', tenantId: 't', role: 'STAFF', workspace: null, locale: 'ar', timezone: 'Asia/Amman', erpVersion: 'x', enabledModules: [] };
  it('denies oversize prompts', () => {
    const r = new PolicyRegistry();
    const d = r.evaluate({ message: 'a'.repeat(9000), requestedTier: 'small', requestKind: 'simple-lookup', chosenModel: 'openai/gpt-4o-mini', ctx });
    expect(d.kind).toBe('deny');
  });
  it('honors per-tenant disabledModels', () => {
    const r = new PolicyRegistry();
    r.setForTenant('t', { disabledModels: ['openai/gpt-4o'] });
    const d = r.evaluate({ message: 'hi', requestedTier: 'medium', requestKind: 'business-query', chosenModel: 'openai/gpt-4o', ctx });
    expect(d.kind).toBe('deny');
  });
  it('allows model in allow-list', () => {
    const r = new PolicyRegistry();
    r.setForTenant('t', { allowedModels: ['openai/gpt-4o-mini'] });
    const d = r.evaluate({ message: 'hi', requestedTier: 'small', requestKind: 'simple-lookup', chosenModel: 'openai/gpt-4o-mini', ctx });
    expect(d.kind).toBe('allow');
  });
});

describe('PromptManager', () => {
  it('default manager returns non-empty global prompt', () => {
    const pm = createDefaultPromptManager();
    const p = pm.buildSystemPrompt({ locale: 'ar' });
    expect(p.length).toBeGreaterThan(20);
  });
  it('module prompt appends after global', () => {
    const pm = createDefaultPromptManager();
    pm.register({ id: 'module.inv.v1', scope: 'module', module: 'inventory', version: 1, locale: 'ar', content: '[INV-PROMPT]' });
    const p = pm.buildSystemPrompt({ locale: 'ar', module: 'inventory' });
    expect(p).toContain('[INV-PROMPT]');
  });
  it('latest-version wins per (scope, locale)', () => {
    const pm = new PromptManager();
    pm.register({ id: 'g.v1', scope: 'global', version: 1, locale: 'ar', content: 'v1' });
    pm.register({ id: 'g.v2', scope: 'global', version: 2, locale: 'ar', content: 'v2' });
    expect(pm.buildSystemPrompt({ locale: 'ar' })).toContain('v2');
  });
});

describe('ContextBuilder', () => {
  it('build + render produces stable identity block', () => {
    const cb = new ContextBuilder('1.0.0', ['inventory', 'production']);
    const c = cb.build({ userId: 'u1', tenantId: 't1', role: 'MANAGER', workspace: 'inventory', locale: 'en' });
    const txt = cb.render(c);
    expect(txt).toContain('Tenant: t1');
    expect(txt).toContain('Workspace: inventory');
    expect(txt).toContain('inventory');
  });
});

describe('ToolRegistry + Executor + Permissions', () => {
  const ctx: any = { userId: 'u', tenantId: 't', role: 'STAFF', workspace: null, locale: 'ar', timezone: 'Asia/Amman', erpVersion: 'x', enabledModules: [] };
  const stubTool: AiTool = {
    name: 'inv.count',
    description: 'count items',
    module: 'inventory',
    requiredPermissions: [],
    inputSchema: { type: 'object', required: ['filter'] },
    outputSchema: { type: 'object' },
    async handle(input) {
      return { ok: true, data: { count: 42, filter: input.args.filter } };
    },
  };

  it('registers + describes tools', () => {
    const r = new ToolRegistry();
    r.register(stubTool);
    expect(r.size()).toBe(1);
    const d = r.describe();
    expect(d[0].name).toBe('inv.count');
    expect((d[0] as any).handle).toBeUndefined();
  });

  it('executor runs a valid call', async () => {
    const r = new ToolRegistry(); r.register(stubTool);
    const ex = new ToolExecutor(r, new DefaultPermissionGate());
    const res = await ex.execute({ toolName: 'inv.count', args: { filter: 'active' }, ctx, requestId: 'r1' });
    expect(res.ok).toBe(true);
    expect((res.data as any).count).toBe(42);
  });

  it('executor rejects missing required field', async () => {
    const r = new ToolRegistry(); r.register(stubTool);
    const ex = new ToolExecutor(r, new DefaultPermissionGate());
    const res = await ex.execute({ toolName: 'inv.count', args: {}, ctx, requestId: 'r' });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('invalid-input');
  });

  it('permission gate denies admin-only tool for STAFF', async () => {
    const adminOnly: AiTool = { ...stubTool, name: 'inv.wipe', requiredPermissions: ['admin:wipe'] };
    const r = new ToolRegistry(); r.register(adminOnly);
    const ex = new ToolExecutor(r, new DefaultPermissionGate());
    const res = await ex.execute({ toolName: 'inv.wipe', args: { filter: '*' }, ctx, requestId: 'r' });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('permission-denied');
  });

  it('permission gate allows manager-only tool for MANAGER role', async () => {
    const mgrOnly: AiTool = { ...stubTool, name: 'inv.reset', requiredPermissions: ['manager:reset'] };
    const r = new ToolRegistry(); r.register(mgrOnly);
    const ex = new ToolExecutor(r, new DefaultPermissionGate());
    const mgr = { ...ctx, role: 'MANAGER' };
    const res = await ex.execute({ toolName: 'inv.reset', args: { filter: '*' }, ctx: mgr, requestId: 'r' });
    expect(res.ok).toBe(true);
  });

  it('unknown tool → not-found', async () => {
    const ex = new ToolExecutor(new ToolRegistry(), new DefaultPermissionGate());
    const res = await ex.execute({ toolName: 'nope', args: {}, ctx, requestId: 'r' });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('not-found');
  });
});

describe('MCP adapter (shape only)', () => {
  const ctx: any = { userId: 'u', tenantId: 't', role: 'ADMIN', workspace: null, locale: 'ar', timezone: 'Asia/Amman', erpVersion: 'x', enabledModules: [] };
  const stubTool: AiTool = {
    name: 'inv.count',
    description: 'count items',
    module: 'inventory',
    requiredPermissions: [],
    inputSchema: { type: 'object', required: ['filter'] },
    outputSchema: { type: 'object' },
    async handle() { return { ok: true, data: { count: 42 } }; },
  };

  it('toMcpToolDescriptors returns MCP shape', () => {
    const r = new ToolRegistry(); r.register(stubTool);
    const desc = toMcpToolDescriptors(r);
    expect(desc[0].name).toBe('inv.count');
    expect(desc[0].description).toContain('[inventory]');
    expect(desc[0].inputSchema).toBeDefined();
  });

  it('handleMcpCall bridges to executor', async () => {
    const r = new ToolRegistry(); r.register(stubTool);
    const ex = new ToolExecutor(r, new DefaultPermissionGate());
    const res = await handleMcpCall(ex, ctx, { name: 'inv.count', arguments: { filter: 'x' } });
    expect(res.isError).toBeFalsy();
    expect(res.content[0].type).toBe('text');
    expect(res.content[0].text).toContain('42');
  });

  it('handleMcpCall returns isError:true for permission failure', async () => {
    const secured: AiTool = { ...stubTool, name: 'inv.wipe', requiredPermissions: ['admin:wipe'] };
    const r = new ToolRegistry(); r.register(secured);
    const ex = new ToolExecutor(r, new DefaultPermissionGate());
    const staffCtx = { ...ctx, role: 'STAFF' };
    const res = await handleMcpCall(ex, staffCtx, { name: 'inv.wipe', arguments: { filter: '*' } });
    expect(res.isError).toBe(true);
  });
});

describe('Noop memory', () => {
  it('returns empty results without throwing', async () => {
    const mem = createNoopMemory();
    await mem.conversation.append('c', { role: 'user', content: 'hi', ts: 0 });
    expect(await mem.conversation.recent('c', 10)).toEqual([]);
    expect(await mem.conversation.toMessages('c', 10)).toEqual([]);
    expect(await mem.tenant.get('s', 'k')).toBeUndefined();
    expect(await mem.tenant.list('s')).toEqual({});
  });
});
