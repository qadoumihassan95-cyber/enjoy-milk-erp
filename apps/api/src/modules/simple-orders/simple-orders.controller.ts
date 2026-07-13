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
import { SimpleOrdersService } from './simple-orders.service';

@ApiTags('simple-orders')
@ApiBearerAuth()
@Controller('orders')
export class SimpleOrdersController {
  constructor(private readonly service: SimpleOrdersService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('orderType') orderType?: string,
  ) {
    return this.service.list(user.tenantId, { status, search, orderType });
  }

  @Get('report')
  report(@CurrentUser() user: AuthenticatedUser) {
    return this.service.report(user.tenantId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.get(user.tenantId, id);
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
    return this.service.update(user.tenantId, user.id, id, body);
  }

  /** تحديث الحقول العلوية فقط دون تعديل البنود ولا المخزون */
  @Patch(':id/meta')
  updateMeta(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.service.updateMeta(user.tenantId, id, body);
  }

  @Post(':id/pay')
  pay(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body()
    body: {
      amount: number;
      method?: string;
      notes?: string;
      allowOverpay?: boolean;
    },
  ) {
    return this.service.addPayment(user.tenantId, id, body, user.id);
  }

  // قائمة الدفعات لطلبية + إجمالي المدفوع/المتبقي (مع backfill شفاف)
  @Get(':id/payments')
  payments(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.listPayments(user.tenantId, id);
  }

  @Delete('payments/:paymentId')
  deletePayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('paymentId') paymentId: string,
  ) {
    return this.service.deletePayment(user.tenantId, paymentId);
  }

  @Roles('MANAGER')
  @Delete(':id')
  delete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.delete(user.tenantId, user.id, id);
  }
}
