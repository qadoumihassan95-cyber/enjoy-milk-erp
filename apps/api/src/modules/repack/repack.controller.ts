import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import type { AuthenticatedUser } from '../../core/auth/jwt.strategy';
import { RepackService } from './repack.service';

@ApiTags('repack')
@ApiBearerAuth()
@Controller('repack')
export class RepackController {
  constructor(private readonly service: RepackService) {}

  @Get('machines')
  machines(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listMachines(user.tenantId);
  }

  @Get('lines')
  lines(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listLines(user.tenantId);
  }

  @Get('orders')
  orders(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listOrders(user.tenantId);
  }

  @Post('orders')
  createOrder(@CurrentUser() user: AuthenticatedUser, @Body() body: any) {
    return this.service.createOrder(user.tenantId, user.id, body);
  }

  @Post('quick')
  quickEntry(@CurrentUser() user: AuthenticatedUser, @Body() body: any) {
    return this.service.quickEntry(user.tenantId, user.id, body);
  }

  @Get('active-context')
  activeContext(
    @CurrentUser() user: AuthenticatedUser,
    @Query('machineId') machineId: string,
  ) {
    return this.service.getActiveContext(user.tenantId, machineId);
  }

  @Post('runs/:id/complete')
  completeRun(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.service.completeRun(user.tenantId, user.id, id);
  }

  @Get('summary/today')
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getDailySummary(user.tenantId);
  }
}
