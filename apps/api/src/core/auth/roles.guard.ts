import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';

/**
 * حارس الأدوار. يعمل بعد JwtAuthGuard.
 * - بدون @Roles → يسمح (لا تقييد).
 * - مع @Roles → يسمح فقط للأدوار المحددة + OWNER/ADMIN دائماً.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user?.role) return false;

    // المالك والأدمن لهم صلاحية كاملة دائماً
    if (user.role === 'OWNER' || user.role === 'ADMIN') return true;

    return required.includes(user.role);
  }
}
