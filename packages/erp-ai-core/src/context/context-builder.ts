/**
 * AI Context Builder.
 *
 * Assembles the "context envelope" that every AI request carries.
 * The context is injected as a system-scope prefix (via the Prompt
 * Manager) — it is NOT sent as ERP data. Data joining is Phase 2 via
 * the Tool Registry.
 *
 * Everything in the context is:
 *   · Identity — who / which tenant / branch / role
 *   · Locale — ar/en
 *   · Timezone — for date formatting hints
 *   · Environment — ERP version, enabled modules
 *
 * Never includes: passwords, tokens, PII beyond user id, or business
 * data. Those must go through registered tools.
 */

export interface AiContext {
  userId: string;
  tenantId: string;
  branchId?: string | null;
  role: string;                       // ADMIN | MANAGER | STAFF | …
  workspace?: string | null;          // 'inventory' | 'production' | …
  locale: 'ar' | 'en';
  timezone: string;                   // e.g. 'Asia/Amman'
  erpVersion: string;                 // git SHA or SemVer
  enabledModules: string[];
  /** Extra metadata forwarded by the caller (page url, feature id, …). */
  extra?: Record<string, string | number | boolean | null | undefined>;
}

export interface ContextBuilderInput {
  userId: string;
  tenantId: string;
  branchId?: string | null;
  role: string;
  workspace?: string | null;
  locale?: 'ar' | 'en';
  extra?: AiContext['extra'];
}

export class ContextBuilder {
  constructor(
    private readonly erpVersion: string,
    private readonly enabledModules: string[],
    private readonly defaultTimezone: string = 'Asia/Amman',
  ) {}

  build(input: ContextBuilderInput): AiContext {
    return {
      userId: input.userId,
      tenantId: input.tenantId,
      branchId: input.branchId ?? null,
      role: input.role,
      workspace: input.workspace ?? null,
      locale: input.locale ?? 'ar',
      timezone: this.defaultTimezone,
      erpVersion: this.erpVersion,
      enabledModules: this.enabledModules,
      extra: input.extra,
    };
  }

  /**
   * Render the context as a short system-prompt paragraph. Never
   * include user-content; only metadata.
   */
  render(ctx: AiContext): string {
    const modules = ctx.enabledModules.length
      ? ctx.enabledModules.join(', ')
      : '—';
    return [
      `[Context]`,
      `Tenant: ${ctx.tenantId}`,
      `User: ${ctx.userId} (role: ${ctx.role})`,
      ctx.branchId ? `Branch: ${ctx.branchId}` : null,
      ctx.workspace ? `Workspace: ${ctx.workspace}` : null,
      `Locale: ${ctx.locale}`,
      `Timezone: ${ctx.timezone}`,
      `ERP: ${ctx.erpVersion}`,
      `Modules: ${modules}`,
    ].filter(Boolean).join('\n');
  }
}
