import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { Roles } from '../../core/auth/roles.decorator';
import type { AuthenticatedUser } from '../../core/auth/jwt.strategy';
import { TelegramAccountsService } from './telegram-accounts.service';

@ApiTags('telegram-accounts')
@ApiBearerAuth()
@Roles('MANAGER') // المدير/المالك/الأدمن فقط (OWNER/ADMIN يمرّون تلقائياً)
@Controller('telegram/accounts')
export class TelegramAccountsController {
  constructor(private readonly service: TelegramAccountsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.tenantId);
  }

  // يجب أن يسبق المسار الثابت 'logs' المسار المتغيّر ':id'
  @Get('logs')
  logs(
    @CurrentUser() user: AuthenticatedUser,
    @Query('accountId') accountId?: string,
    @Query('direction') direction?: string,
    @Query('q') q?: string,
  ) {
    return this.service.logs(user.tenantId, { accountId, direction, q });
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.get(user.tenantId, id);
  }

  @Get(':id/logs')
  accountLogs(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.logs(user.tenantId, { accountId: id });
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: any) {
    return this.service.create(user.tenantId, user.id, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.service.update(user.tenantId, id, body);
  }

  @Post(':id/test')
  test(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.test(user.tenantId, id);
  }

  @Post(':id/reconnect')
  reconnect(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.reconnect(user.tenantId, id);
  }

  @Post(':id/disable')
  disable(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.disable(user.tenantId, id);
  }

  @Post(':id/enable')
  enable(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.enable(user.tenantId, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.remove(user.tenantId, id);
  }
}
