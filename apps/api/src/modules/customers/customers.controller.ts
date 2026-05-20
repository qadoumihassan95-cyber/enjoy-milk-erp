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
import type { AuthenticatedUser } from '../../core/auth/jwt.strategy';
import { CustomersService } from './customers.service';

@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(private readonly service: CustomersService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('search') search?: string,
  ) {
    return this.service.list(user.tenantId, search);
  }

  @Get('stats')
  stats(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getCustomerStats(user.tenantId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.get(user.tenantId, id);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: any) {
    return this.service.create(user.tenantId, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.service.update(user.tenantId, id, body);
  }

  @Delete(':id')
  delete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.delete(user.tenantId, id);
  }

  // Orders
  @Get('orders/list')
  orders(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listOrders(user.tenantId);
  }

  @Post('orders/create')
  createOrder(@CurrentUser() user: AuthenticatedUser, @Body() body: any) {
    return this.service.createOrder(user.tenantId, user.id, body);
  }

  // Payments
  @Get('payments/list')
  payments(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listPayments(user.tenantId);
  }

  @Post('payments/create')
  createPayment(@CurrentUser() user: AuthenticatedUser, @Body() body: any) {
    return this.service.createPayment(user.tenantId, user.id, body);
  }
}
