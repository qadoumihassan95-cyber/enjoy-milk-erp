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
import { DailyProductionService } from './daily-production.service';

@ApiTags('daily-production')
@ApiBearerAuth()
@Controller('daily-production')
export class DailyProductionController {
  constructor(private readonly service: DailyProductionService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.list(user.tenantId, { from, to });
  }

  @Get('report/daily')
  dailyReport(
    @CurrentUser() user: AuthenticatedUser,
    @Query('date') date?: string,
  ) {
    return this.service.dailyReport(
      user.tenantId,
      date ? new Date(date) : new Date(),
    );
  }

  /** رصيد المخزون الحالي (الحليب + الكرتون + الألمنيوم) */
  @Get('warehouse-balance')
  balance(@CurrentUser() user: AuthenticatedUser) {
    return this.service.computeWarehouseBalance(user.tenantId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.getWithBalance(user.tenantId, id);
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

  /** حفظ كل أقسام الورقة دفعة واحدة */
  @Post(':id/save-all')
  saveAll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.service.saveAll(user.tenantId, id, body);
  }

  /** ترحيل للمخزون */
  @Post(':id/post')
  post(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.post(user.tenantId, user.id, id);
  }

  /** إلغاء الترحيل */
  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.cancel(user.tenantId, user.id, id);
  }

  @Roles('MANAGER')
  @Delete(':id')
  delete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.delete(user.tenantId, id);
  }
}
