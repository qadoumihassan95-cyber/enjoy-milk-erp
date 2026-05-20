import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { Roles } from '../auth/roles.decorator';
import { AuditService } from './audit.service';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** سجل العمليات — للمدراء فقط (OWNER/ADMIN يُسمح لهم تلقائياً) */
  @Get()
  @Roles('MANAGER')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
    @Query('resource') resource?: string,
    @Query('action') action?: string,
  ) {
    return this.audit.list(user.tenantId, {
      limit: limit ? parseInt(limit, 10) : 100,
      resource,
      action,
    });
  }
}
