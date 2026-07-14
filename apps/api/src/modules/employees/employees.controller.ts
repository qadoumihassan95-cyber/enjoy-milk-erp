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
import { PrismaService } from '../../core/prisma/prisma.service';

@ApiTags('employees')
@ApiBearerAuth()
@Controller('employees')
export class EmployeesController {
  constructor(
    private readonly service: EmployeesService,
    private readonly prisma: PrismaService,
  ) {}

  // ─── Payroll Settings (SS basis + rates) ─────────
  @Get('payroll/settings')
  @Roles('MANAGER', 'ACCOUNTANT', 'HR')
  async getPayrollSettings(@CurrentUser() user: AuthenticatedUser) {
    let s = await this.prisma.tenantSetting.findUnique({ where: { tenantId: user.tenantId } });
    if (!s) {
      s = await this.prisma.tenantSetting.create({
        data: { tenantId: user.tenantId },
      });
    }
    return {
      socialSecurityBasis: s.socialSecurityBasis ?? 'BASIC',
      employeeSSRate: Number((s as any).employeeSSRate ?? 0.075),
      companySSRate: Number((s as any).companySSRate ?? 0.1425),
      availableBases: ['BASIC', 'BASIC_PLUS_TRANSPORT', 'GROSS'],
    };
  }

  @Post('payroll/settings')
  @Roles('MANAGER', 'ACCOUNTANT')
  async setPayrollSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { socialSecurityBasis?: string; employeeSSRate?: number; companySSRate?: number },
  ) {
    const allowed = ['BASIC', 'BASIC_PLUS_TRANSPORT', 'GROSS'];
    const basis = allowed.includes(String(body.socialSecurityBasis)) ? body.socialSecurityBasis : 'BASIC';
    return this.prisma.tenantSetting.upsert({
      where: { tenantId: user.tenantId },
      create: {
        tenantId: user.tenantId,
        socialSecurityBasis: basis!,
        employeeSSRate: body.employeeSSRate ?? 0.075,
        companySSRate: body.companySSRate ?? 0.1425,
        updatedById: user.id,
      },
      update: {
        socialSecurityBasis: basis!,
        employeeSSRate: body.employeeSSRate ?? undefined,
        companySSRate: body.companySSRate ?? undefined,
        updatedById: user.id,
      },
    });
  }

  // ─── Employee advances (سلف الموظفين) ─────────────
  @Get('advances')
  @Roles('MANAGER', 'ACCOUNTANT', 'HR')
  listAdvances(@CurrentUser() user: AuthenticatedUser, @Query('employeeId') employeeId?: string) {
    return this.prisma.employeeAdvance.findMany({
      where: { tenantId: user.tenantId, ...(employeeId ? { employeeId } : {}) },
      include: { installments: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post('advances')
  @Roles('MANAGER', 'ACCOUNTANT', 'HR')
  async createAdvance(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: {
      employeeId: string;
      amount: number;
      installmentAmount: number;
      installmentsCount: number;
      startMonth: string;
      notes?: string;
    },
  ) {
    if (!(body.amount > 0)) throw new Error('مبلغ السلفة غير صحيح');
    if (!(body.installmentAmount > 0)) throw new Error('قيمة القسط غير صحيحة');
    return this.prisma.employeeAdvance.create({
      data: {
        tenantId: user.tenantId,
        employeeId: body.employeeId,
        amount: body.amount,
        installmentAmount: body.installmentAmount,
        installmentsCount: body.installmentsCount,
        startMonth: body.startMonth,
        notes: body.notes ?? null,
        createdById: user.id,
      },
    });
  }

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

  /** تقرير رواتب سنوي (12 شهر) للطباعة */
  @Get('payroll/annual')
  @Roles('MANAGER', 'ACCOUNTANT', 'HR')
  async payrollAnnual(
    @CurrentUser() user: AuthenticatedUser,
    @Query('year') year?: string,
  ) {
    const y = year ? Number(year) : new Date().getFullYear();
    const months: any[] = [];
    for (let m = 0; m < 12; m++) {
      const key = `${y}-${String(m + 1).padStart(2, '0')}`;
      months.push(await this.service.getPayroll(user.tenantId, key));
    }
    return { year: y, months };
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
      overtimeAmount?: number | null;
      transportOverride?: number | null;
      extraDeductions?: number;
      overrideReason?: string | null;
      updateEmployeeTransport?: boolean;
    },
  ) {
    return this.service.savePayrollAdjustment(user.tenantId, user.id, body);
  }

  /** حفظ الكل — bulk save لصفوف الشهر */
  @Post('payroll/save-all')
  @Roles('MANAGER', 'ACCOUNTANT', 'HR')
  saveAllPayroll(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { month: string; rows: any[] },
  ) {
    return this.service.saveAllPayroll(user.tenantId, user.id, body);
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

  // ─── الوثائق ─────────────────────────────────────
  @Get(':id/documents')
  listDocuments(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.service.listDocuments(user.tenantId, id);
  }

  @Get('documents/:docId')
  getDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('docId') docId: string,
  ) {
    return this.service.getDocument(user.tenantId, docId);
  }

  @Post(':id/documents')
  createDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.service.createDocument(user.tenantId, user.id, id, body);
  }

  @Delete('documents/:docId')
  deleteDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('docId') docId: string,
  ) {
    return this.service.deleteDocument(user.tenantId, docId);
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
