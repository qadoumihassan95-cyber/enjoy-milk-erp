import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from './audit.service';

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
// مسارات لا نسجّلها (تسجيل دخول/تحديث توكن لتفادي ضوضاء وحساسية)
const SKIP = ['/api/auth/login', '/api/auth/refresh', '/api/telegram/webhook'];

/**
 * Interceptor عام يسجّل كل عملية تغيير (POST/PATCH/PUT/DELETE) في الـ Audit Log.
 * يعمل بنمط fire-and-forget فلا يؤثر على زمن الاستجابة.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const method: string = req.method;

    if (!MUTATING.has(method) || SKIP.some((p) => req.originalUrl?.startsWith(p))) {
      return next.handle();
    }

    // altqet IP الحقيقي مع مراعاة الـ proxy (X-Forwarded-For)
    const rawIp: string =
      req.headers?.['x-forwarded-for']?.toString().split(',')[0].trim() ||
      req.ip ||
      req.connection?.remoteAddress ||
      '';
    const userAgent: string = req.headers?.['user-agent']?.toString() ?? '';
    const path = (req.originalUrl || req.url || '').split('?')[0];

    return next.handle().pipe(
      tap((result) => {
        const user = req.user;
        if (!user?.tenantId) return;
        const res = context.switchToHttp().getResponse();
        this.audit
          .log({
            tenantId: user.tenantId,
            actorUserId: user.id,
            action: method,
            resource: (req.route?.path || path || '').split('?')[0],
            resourceId: result?.id || req.params?.id || null,
            ip: rawIp,
            userAgent,
            method,
            path,
            status: res?.statusCode ?? null,
          })
          .catch(() => undefined);
      }),
    );
  }
}
