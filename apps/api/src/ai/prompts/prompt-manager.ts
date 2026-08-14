/**
 * Prompt Manager — single source of truth for every system prompt.
 *
 * Design goals:
 *   · Never hardcode a prompt inside a service or controller.
 *   · Support future localization (Arabic vs English variants).
 *   · Support future prompt versioning (A/B tests, rollbacks).
 *   · Support role-, module-, and workspace-scoped prompts on top of
 *     the global base prompt.
 *
 * All prompts are registered here at startup (or dynamically at runtime
 * for tenants that override them). `buildSystemPrompt()` composes them
 * in a deterministic order.
 */

export type PromptScope = 'global' | 'system' | 'module' | 'role';
export type Locale = 'ar' | 'en';

export interface Prompt {
  /** Stable id — e.g. 'global.assistant.v1' or 'module.inventory.v2'. */
  id: string;
  scope: PromptScope;
  /** Module (`inventory`, `production`) — only for `module` scope. */
  module?: string;
  /** Role (`ADMIN`, `MANAGER`, `STAFF`) — only for `role` scope. */
  role?: string;
  /** Prompt version — allows rollbacks; latest per (scope, module, role, locale) wins. */
  version: number;
  locale: Locale;
  content: string;
}

export interface PromptComposeInput {
  locale?: Locale;
  module?: string;
  role?: string;
}

export class PromptManager {
  private prompts = new Map<string, Prompt>();

  register(p: Prompt) {
    this.prompts.set(p.id, p);
  }

  /** Bulk register — used at bootstrap. */
  registerAll(list: Prompt[]) {
    for (const p of list) this.register(p);
  }

  /** Find the latest-version prompt matching a scope-narrowed filter. */
  private latest(
    scope: PromptScope,
    filters: { module?: string; role?: string; locale: Locale },
  ): Prompt | undefined {
    let best: Prompt | undefined;
    for (const p of this.prompts.values()) {
      if (p.scope !== scope) continue;
      if (filters.module && p.module !== filters.module) continue;
      if (filters.role && p.role !== filters.role) continue;
      if (p.locale !== filters.locale) continue;
      if (!best || p.version > best.version) best = p;
    }
    return best;
  }

  /**
   * Compose the effective system prompt for a request in a stable
   * order: global → system → module → role. Missing scopes are
   * simply skipped.
   */
  buildSystemPrompt(input: PromptComposeInput = {}): string {
    const locale: Locale = input.locale ?? 'ar';
    const parts: string[] = [];

    const g = this.latest('global', { locale });
    if (g) parts.push(g.content);

    const s = this.latest('system', { locale });
    if (s) parts.push(s.content);

    if (input.module) {
      const m = this.latest('module', { module: input.module, locale });
      if (m) parts.push(m.content);
    }
    if (input.role) {
      const r = this.latest('role', { role: input.role, locale });
      if (r) parts.push(r.content);
    }
    return parts.join('\n\n').trim();
  }

  /** For diagnostics / future admin UI. Never returned to end users. */
  list(): Prompt[] {
    return Array.from(this.prompts.values());
  }
}

/**
 * Factory returning a PromptManager pre-seeded with sane defaults.
 * These are the ONLY hardcoded prompts in the whole codebase — every
 * other module talks to the PromptManager instead of embedding text.
 */
export function createDefaultPromptManager(): PromptManager {
  const pm = new PromptManager();
  pm.registerAll([
    {
      id: 'global.assistant.v1',
      scope: 'global',
      version: 1,
      locale: 'ar',
      content:
        'أنت مساعد ذكي مدمج في نظام ERP لمصنع منتجات الحليب.\n' +
        'أجب بالعربية بشكل موجز ومهني. إذا كان السؤال يحتاج بيانات من ' +
        'النظام، اذكر أنك تحتاج للاتصال بأداة داخلية بدلاً من التخمين.\n' +
        'لا تكشف أي أسرار تشغيلية أو مفاتيح.',
    },
    {
      id: 'global.assistant.v1.en',
      scope: 'global',
      version: 1,
      locale: 'en',
      content:
        'You are an assistant embedded in a dairy factory ERP. Answer ' +
        'concisely and professionally. If a question needs system data, ' +
        'say you would call an internal tool rather than guess. Never ' +
        'reveal secrets or credentials.',
    },
    {
      id: 'system.safety.v1',
      scope: 'system',
      version: 1,
      locale: 'ar',
      content:
        'قواعد سلامة صارمة:\n' +
        '- لا تُصدر أوامر مالية أو تعديلات على قواعد البيانات مباشرةً.\n' +
        '- لا تخترع أرقاماً؛ اطلب استدعاء أداة إذا لزم.\n' +
        '- التزم بصلاحيات المستخدم الحالي؛ لا تتجاوز RBAC.',
    },
    {
      id: 'system.safety.v1.en',
      scope: 'system',
      version: 1,
      locale: 'en',
      content:
        'Strict safety rules:\n' +
        '- Never issue write operations directly.\n' +
        '- Never invent numbers; ask to call a tool if needed.\n' +
        '- Respect the current user permissions; never bypass RBAC.',
    },
  ]);
  return pm;
}
