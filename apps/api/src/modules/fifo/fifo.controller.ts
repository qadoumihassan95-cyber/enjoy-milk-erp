import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { Roles } from '../../core/auth/roles.decorator';
import type { AuthenticatedUser } from '../../core/auth/jwt.strategy';
import { FifoCostingService } from './fifo.service';
import { PrismaService } from '../../core/prisma/prisma.service';

@ApiTags('fifo')
@ApiBearerAuth()
@Controller('fifo')
export class FifoController {
  constructor(
    private readonly service: FifoCostingService,
    private readonly prisma: PrismaService,
  ) {}

  // ─── تقارير ──────────────────────────────────────
  @Get('reports/inventory-value')
  inventoryValue(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getInventoryValue(user.tenantId);
  }

  @Get('reports/cogs-profit')
  cogsProfit(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.getCogsProfit(user.tenantId, { from, to });
  }

  @Get('batches')
  batches(
    @CurrentUser() user: AuthenticatedUser,
    @Query('itemId') itemId?: string,
    @Query('onlyOpen') onlyOpen?: string,
  ) {
    return this.service.listBatches(user.tenantId, {
      itemId,
      onlyOpen: onlyOpen === '1' || onlyOpen === 'true',
    });
  }

  @Get('sales/:saleOrderId/allocations')
  saleAllocations(
    @CurrentUser() user: AuthenticatedUser,
    @Param('saleOrderId') saleOrderId: string,
  ) {
    return this.service.getSaleAllocations(user.tenantId, saleOrderId);
  }

  // ─── إعدادات الأسلوب الحسابي (Settings) ─────────
  @Get('settings')
  async getSettings(@CurrentUser() user: AuthenticatedUser) {
    let s = await this.prisma.tenantSetting.findUnique({
      where: { tenantId: user.tenantId },
    });
    if (!s) {
      s = await this.prisma.tenantSetting.create({
        data: { tenantId: user.tenantId, costingMethod: 'FIFO' },
      });
    }
    return {
      ...s,
      availableMethods: ['FIFO'], // مستقبلاً: 'AVG', 'LIFO'
    };
  }

  @Roles('MANAGER')
  @Post('settings')
  async setSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { costingMethod?: string; costingCurrency?: string; baseCurrency?: string },
  ) {
    // حالياً FIFO فقط مسموح
    const method = body.costingMethod === 'FIFO' ? 'FIFO' : 'FIFO';
    // ─── العملة الأساسية ─
    const allowed = ['JOD', 'USD'];
    const baseCurrency = body.baseCurrency && allowed.includes(body.baseCurrency)
      ? body.baseCurrency
      : undefined;
    return this.prisma.tenantSetting.upsert({
      where: { tenantId: user.tenantId },
      create: {
        tenantId: user.tenantId,
        costingMethod: method,
        costingCurrency: body.costingCurrency ?? 'JOD',
        baseCurrency: baseCurrency ?? 'JOD',
        updatedById: user.id,
      } as any,
      update: {
        costingMethod: method,
        costingCurrency: body.costingCurrency ?? undefined,
        ...(baseCurrency ? { baseCurrency } : {}),
        updatedById: user.id,
      } as any,
    });
  }
}
