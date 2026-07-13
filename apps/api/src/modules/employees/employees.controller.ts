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

  /** كشف رواتب الشهر (حساب تلقائي) — للمدراء/المحاسب/الموارد البشرية */
  @Get('payroll')
  @Roles('MANAGER', 'ACCOUNTANT', 'HR')
  payroll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('month') month?: string,
  ) {
    return this.service.getPayroll(user.tenantId, month);
  }

  /** حفظ تعديل يدوي على راتب الشهر (مكافأة/خصم/تجاوز/ملاحظات) */
  @Post('payroll/adjustment')
  @Roles('MANAGER', 'ACCOUNTANT', 'HR')
  savePayrollAdjustment(
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: {
      employeeId: string;
      month: string;
      bonus?: number;
      deduction?: number;
      overrideNet?: number | null;
      notes?: string | null;
    },
  ) {
    return this.service.savePayrollAdjustment(user.tenantId, user.id, body);
  }

  /** صرف الرواتب (لموظف أو للكل) — يخصم من الصندوق ويسجّل مصروف */
  @Post('payroll/pay')
  @Roles('MANAGER', 'ACCOUNTANT')
  payPayroll(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { month: string; employeeId?: string; cashboxId?: string },
  ) {
    return this.service.payPayroll(user.tenantId, user.id, body);
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

  @Roles('MANAGER')
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

  // ─── العمل الإضافي (Overtime) ──────────────────────
  /** كشف العمل الإضافي لموظف خلال شهر (سجلات + إجماليات + قيمة) */
  @Get(':id/overtime')
  overtime(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('month') month?: string,
  ) {
    return this.service.getEmployeeOvertime(user.tenantId, id, month);
  }

  /** إضافة/تعيين ساعات إضافية ليوم محدد */
  @Post(':id/overtime')
  addOvertime(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { date?: string; hours: number; notes?: string },
  ) {
    return this.service.addOvertimeForDate(user.tenantId, id, body);
  }

  /** تعديل سجل عمل إضافي */
  @Patch('overtime/:recordId')
  updateOvertime(
    @CurrentUser() user: AuthenticatedUser,
    @Param('recordId') recordId: string,
    @Body() body: { hours?: number; notes?: string },
  ) {
    return this.service.updateOvertimeEntry(user.tenantId, recordId, body);
  }

  /** حذف العمل الإضافي من سجل (تصفير الساعات) */
  @Delete('overtime/:recordId')
  deleteOvertime(
    @CurrentUser() user: AuthenticatedUser,
    @Param('recordId') recordId: string,
  ) {
    return this.service.deleteOvertimeEntry(user.tenantId, recordId);
  }
}
