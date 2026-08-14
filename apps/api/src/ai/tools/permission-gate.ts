/**
 * Default PermissionGate — bridges the AI tool infrastructure to the
 * app's existing role-based RBAC.
 *
 * The current ERP uses simple string roles (`ADMIN`, `MANAGER`,
 * `STAFF`). Permission slugs on tools are advisory strings — this
 * default gate maps them to roles:
 *   · `admin:*`   → ADMIN
 *   · `manager:*` → ADMIN or MANAGER
 *   · anything else → any authenticated user
 *
 * Swap this for a fine-grained implementation (per-slug matrix, per-
 * branch grants) when the ERP adds richer RBAC — the AI code doesn't
 * change.
 */

import type { AiContext } from '../context/context-builder';
import type { PermissionGate } from './tool.types';

export class DefaultPermissionGate implements PermissionGate {
  allows(ctx: AiContext, required: string[]): boolean {
    if (!ctx.userId) return false;
    if (!required || required.length === 0) return true;
    const role = (ctx.role || '').toUpperCase();
    for (const slug of required) {
      const s = slug.toLowerCase();
      if (s.startsWith('admin:')) {
        if (role !== 'ADMIN') return false;
      } else if (s.startsWith('manager:')) {
        if (role !== 'ADMIN' && role !== 'MANAGER') return false;
      }
      // other slugs → allowed for any authenticated user (extend later)
    }
    return true;
  }
}
