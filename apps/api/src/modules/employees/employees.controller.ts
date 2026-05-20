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
import { EmployeesService } from './employees.service';

@ApiTags('employees')
@ApiBearerAuth()
@Controller('employees')
export class EmployeesController {
  constructor(private readonly service: EmployeesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.tenantId);
  }

  @Get('stats')
  stats(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getDailyStats(user.tenantId);
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

  // Attendance
  @Post(':id/check-in')
  checkIn(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.checkIn(user.tenantId, id);
  }

  /** تسجيل حالة: غياب / تأخير / حضور / عمل إضافي */
  @Post(':id/attendance')
  markAttendance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { status?: string; overtimeMin?: number },
  ) {
    return this.service.markAttendance(user.tenantId, id, body);
  }

  @Get('attendance/list')
  attendance(
    @CurrentUser() user: AuthenticatedUser,
    @Query('date') date?: string,
  ) {
    return this.service.listAttendance(user.tenantId, date);
  }
}
