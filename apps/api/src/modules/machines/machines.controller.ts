import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import type { AuthenticatedUser } from '../../core/auth/jwt.strategy';
import { MachinesService } from './machines.service';

@ApiTags('machines')
@ApiBearerAuth()
@Controller('machines')
export class MachinesController {
  constructor(private readonly service: MachinesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.tenantId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { number: number; name?: string },
  ) {
    return this.service.create(user.tenantId, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { number?: number; name?: string; active?: boolean },
  ) {
    return this.service.update(user.tenantId, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.remove(user.tenantId, id);
  }
}
