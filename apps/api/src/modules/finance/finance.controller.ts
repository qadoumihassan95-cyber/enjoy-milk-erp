import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import type { AuthenticatedUser } from '../../core/auth/jwt.strategy';
import { FinanceService } from './finance.service';

@ApiTags('finance')
@ApiBearerAuth()
@Controller('finance')
export class FinanceController {
  constructor(private readonly service: FinanceService) {}

  // Cashboxes
  @Get('cashboxes')
  cashboxes(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listCashboxes(user.tenantId);
  }

  @Post('cashboxes')
  createCashbox(@CurrentUser() user: AuthenticatedUser, @Body() body: any) {
    return this.service.createCashbox(user.tenantId, body);
  }

  // Movements
  @Post('movements')
  addMovement(@CurrentUser() user: AuthenticatedUser, @Body() body: any) {
    return this.service.addMovement(user.tenantId, user.id, body);
  }

  @Get('movements')
  listMovements(
    @CurrentUser() user: AuthenticatedUser,
    @Query('cashboxId') cashboxId?: string,
  ) {
    return this.service.listMovements(user.tenantId, cashboxId);
  }

  // تحويل بين الصناديق
  @Post('transfer')
  transfer(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { fromCashboxId: string; toCashboxId: string; amount: number; description?: string },
  ) {
    return this.service.transferBetweenCashboxes(user.tenantId, user.id, body);
  }

  // Cheques
  @Get('cheques')
  cheques(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
  ) {
    return this.service.listCheques(user.tenantId, status);
  }

  @Post('cheques')
  createCheque(@CurrentUser() user: AuthenticatedUser, @Body() body: any) {
    return this.service.createCheque(user.tenantId, body);
  }

  @Patch('cheques/:id/status')
  updateChequeStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    return this.service.updateChequeStatus(user.tenantId, id, body.status);
  }

  @Get('cheques/upcoming/list')
  upcomingCheques(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getUpcomingCheques(user.tenantId);
  }

  // Expenses
  @Get('expenses')
  expenses(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listExpenses(user.tenantId);
  }

  @Post('expenses')
  createExpense(@CurrentUser() user: AuthenticatedUser, @Body() body: any) {
    return this.service.createExpense(user.tenantId, user.id, body);
  }

  // Summary
  @Get('summary/today')
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getDailySummary(user.tenantId);
  }

  // تقرير مالي شامل (إيرادات/مصاريف/أرباح)
  @Get('report')
  report(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.getFinancialReport(user.tenantId, from, to);
  }
}
