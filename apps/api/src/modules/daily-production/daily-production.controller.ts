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

  /** ملخص يومي موحّد: إجمالي الإنتاج + المنتجات + المواد الخام + نسبة الفاقد */
  @Get('summary/day')
  daySummary(
    @CurrentUser() user: AuthenticatedUser,
    @Query('date') date?: string,
    @Query('itemName') itemName?: string,
  ) {
    return this.service.getDailySummary(user.tenantId, { date, itemName });
  }

  /** رصيد المخزون الحالي (الحليب + الكرتون + الألمنيوم) */
  @Get('warehouse-balance')
  balance(@CurrentUser() user: AuthenticatedUser) {
    return this.service.computeWarehouseBalance(user.tenantId);
  }

  /**
   * تقرير التكلفة والفاقد — SINGLE SOURCE for /reports Cost & Waste tab.
   * Reads real raw-material cost from ProductionCostAllocation, waste
   * quantities from ProductionWaste, produced quantities from
   * ProductionProducedItem. FE MUST bind to this endpoint instead of
   * computing on the client.
   */
  @Get('report/cost-waste')
  costWaste(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.getCostAndWasteReport(user.tenantId, { from, to });
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

  /**
   * ترحيل للمخزون
   *
   * A raw-material shortage no longer aborts with a 400 in WARNING_MODE /
   * OVERRIDE_MODE. The first call returns 200 with
   *   { success: false, requiresConfirmation: true, warnings: [...] }
   * and writes NOTHING. The client shows the confirmation dialog and, on
   * "تسجيل مع تحذير", re-sends with { allowShortage: true } to receive
   *   { success: true, warnings: [...] }.
   * STRICT_MODE keeps the original 400.
   */
  @Post(':id/post')
  post(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { allowShortage?: boolean } = {},
  ) {
    return this.service.post(user.tenantId, user.id, id, {
      allowShortage: !!body?.allowShortage,
      userRole: user.role,
    });
  }

  /** إعدادات وضع الترحيل — القراءة متاحة للجميع */
  @Get('settings/posting-mode')
  getPostingMode(@CurrentUser() user: AuthenticatedUser) {
    return this.service.readPostingMode(user.tenantId);
  }

  /** تغيير وضع الترحيل — للمدراء فقط */
  @Roles('MANAGER')
  @Post('settings/posting-mode')
  setPostingMode(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { mode?: string },
  ) {
    return this.service.writePostingMode(user.tenantId, user.id, body?.mode);
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
