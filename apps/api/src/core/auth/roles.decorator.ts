import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * تقييد الـ endpoint بأدوار محددة. OWNER و ADMIN مسموح لهم دائماً.
 * مثال: @Roles('MANAGER', 'ACCOUNTANT')
 * بدون @Roles → الـ endpoint متاح لأي مستخدم مُصادَق عليه.
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
