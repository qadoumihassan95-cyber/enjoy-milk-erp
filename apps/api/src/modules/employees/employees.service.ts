import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Employees CRUD ──────────────────────────────
  async list(tenantId: string) {
    return this.prisma.employee.findMany({
      where: { tenantId, active: true },
      orderBy: { fullName: 'asc' },
    });
  }

  async get(tenantId: string, id: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id, tenantId },
      include: {
        attendance: {
          orderBy: { date: 'desc' },
          take: 30,
        },
      },
    });
    if (!employee) throw new NotFoundException();
    return employee;
  }

  async create(tenantId: string, data: any) {
    const code = data.code || `E-${Date.now().toString(36).toUpperCase()}`;
    return this.prisma.employee.create({
      data: {
        tenantId,
        code,
        fullName: data.fullName,
        nationalId: data.nationalId,
        phone: data.phone,
        email: data.email,
        department: data.department,
        position: data.position,
        hireDate: data.hireDate ? new Date(data.hireDate) : null,
        baseSalary: data.baseSalary ? new Prisma.Decimal(data.baseSalary) : null,
      },
    });
  }

  async update(tenantId: string, id: string, data: any) {
    await this.get(tenantId, id);
    return this.prisma.employee.update({
      where: { id },
      data: {
        fullName: data.fullName,
        phone: data.phone,
        email: data.email,
        department: data.department,
        position: data.position,
        notes: data.notes,
        baseSalary: data.baseSalary ? new Prisma.Decimal(data.baseSalary) : undefined,
      },
    });
  }

  async delete(tenantId: string, id: string) {
    await this.get(tenantId, id);
    return this.prisma.employee.update({
      where: { id },
      data: { active: false },
    });
  }

  // ─── Attendance ──────────────────────────────────
  async checkIn(tenantId: string, employeeId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existing = await this.prisma.attendanceRecord.findFirst({
      where: { employeeId, date: today },
    });

    if (existing && existing.checkIn && !existing.checkOut) {
      // Check out
      const checkOut = new Date();
      const overtimeMin = 0;
      return this.prisma.attendanceRecord.update({
        where: { id: existing.id },
        data: { checkOut, overtimeMin },
      });
    }

    if (existing) {
      throw new BadRequestException('تم تسجيل الحضور والانصراف اليوم');
    }

    const checkIn = new Date();
    const shiftStart = new Date(today);
    shiftStart.setHours(8, 0, 0, 0);
    const lateMin = Math.max(0, Math.floor((checkIn.getTime() - shiftStart.getTime()) / 60000) - 5);

    return this.prisma.attendanceRecord.create({
      data: {
        tenantId,
        employeeId,
        date: today,
        checkIn,
        lateMin,
        status: lateMin > 0 ? 'LATE' : 'PRESENT',
      },
    });
  }

  /**
   * تسجيل/تحديث حالة الحضور لليوم (غياب / تأخير / حضور / عمل إضافي).
   * opts.status: 'PRESENT' | 'ABSENT' | 'LATE' | 'LEAVE' | 'HALF_DAY'
   * opts.overtimeMin: دقائق العمل الإضافي تُضاف للسجل
   */
  async markAttendance(
    tenantId: string,
    employeeId: string,
    opts: { status?: string; overtimeMin?: number },
  ) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const status = opts.status as any;
    const addOvertime = Number(opts.overtimeMin) || 0;

    const existing = await this.prisma.attendanceRecord.findFirst({
      where: { employeeId, date: today },
    });

    if (existing) {
      return this.prisma.attendanceRecord.update({
        where: { id: existing.id },
        data: {
          ...(status ? { status } : {}),
          ...(status === 'ABSENT' ? { checkIn: null, checkOut: null } : {}),
          ...(status === 'PRESENT' || status === 'LATE'
            ? { checkIn: existing.checkIn ?? new Date() }
            : {}),
          ...(addOvertime ? { overtimeMin: existing.overtimeMin + addOvertime } : {}),
        },
      });
    }

    return this.prisma.attendanceRecord.create({
      data: {
        tenantId,
        employeeId,
        date: today,
        status: status ?? 'PRESENT',
        overtimeMin: addOvertime,
        checkIn: status === 'ABSENT' ? null : new Date(),
      },
    });
  }

  async listAttendance(tenantId: string, date?: string) {
    const targetDate = date ? new Date(date) : new Date();
    targetDate.setHours(0, 0, 0, 0);

    return this.prisma.attendanceRecord.findMany({
      where: { tenantId, date: targetDate },
      include: { employee: true },
      orderBy: { checkIn: 'asc' },
    });
  }

  /**
   * كشف رواتب الشهر — حساب تلقائي:
   *   اليومية = الراتب / أيام العمل (26)
   *   الساعة  = اليومية / 8
   *   خصم الغياب     = أيام الغياب × اليومية
   *   خصم التأخير    = ساعات التأخير × الساعة
   *   أجر الإضافي    = ساعات الإضافي × الساعة × 1.5
   *   الصافي = الأساسي − خصم الغياب − خصم التأخير + أجر الإضافي
   */
  async getPayroll(tenantId: string, monthStr?: string) {
    const ref = monthStr ? new Date(monthStr + '-01') : new Date();
    const start = new Date(ref.getFullYear(), ref.getMonth(), 1);
    const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 1);
    const WORKING_DAYS = 26;
    const round = (n: number) => Math.round(n * 100) / 100;

    const [employees, records] = await Promise.all([
      this.prisma.employee.findMany({ where: { tenantId, active: true } }),
      this.prisma.attendanceRecord.findMany({
        where: { tenantId, date: { gte: start, lt: end } },
      }),
    ]);

    const byEmp = new Map<
      string,
      { present: number; absent: number; lateMin: number; overtimeMin: number }
    >();
    for (const r of records) {
      const e =
        byEmp.get(r.employeeId) ?? { present: 0, absent: 0, lateMin: 0, overtimeMin: 0 };
      if (r.status === 'ABSENT') e.absent++;
      else if (r.checkIn || r.status === 'PRESENT' || r.status === 'LATE') e.present++;
      e.lateMin += r.lateMin || 0;
      e.overtimeMin += r.overtimeMin || 0;
      byEmp.set(r.employeeId, e);
    }

    const rows = employees.map((emp) => {
      const base = Number(emp.baseSalary ?? 0);
      const s = byEmp.get(emp.id) ?? { present: 0, absent: 0, lateMin: 0, overtimeMin: 0 };
      const dailyRate = base / WORKING_DAYS;
      const hourlyRate = dailyRate / 8;
      const absenceDeduction = s.absent * dailyRate;
      const lateDeduction = (s.lateMin / 60) * hourlyRate;
      const overtimePay = (s.overtimeMin / 60) * hourlyRate * 1.5;
      const net = base - absenceDeduction - lateDeduction + overtimePay;
      return {
        employeeId: emp.id,
        code: emp.code,
        fullName: emp.fullName,
        department: emp.department,
        position: emp.position,
        baseSalary: round(base),
        presentDays: s.present,
        absentDays: s.absent,
        lateHours: round(s.lateMin / 60),
        overtimeHours: round(s.overtimeMin / 60),
        absenceDeduction: round(absenceDeduction),
        lateDeduction: round(lateDeduction),
        overtimePay: round(overtimePay),
        net: round(net),
      };
    });

    const totals = rows.reduce(
      (t, r) => ({
        baseSalary: t.baseSalary + r.baseSalary,
        deductions: t.deductions + r.absenceDeduction + r.lateDeduction,
        overtimePay: t.overtimePay + r.overtimePay,
        net: t.net + r.net,
      }),
      { baseSalary: 0, deductions: 0, overtimePay: 0, net: 0 },
    );

    return {
      month: start.toISOString().slice(0, 7),
      workingDays: WORKING_DAYS,
      rows,
      totals: {
        baseSalary: round(totals.baseSalary),
        deductions: round(totals.deductions),
        overtimePay: round(totals.overtimePay),
        net: round(totals.net),
      },
    };
  }

  async getDailyStats(tenantId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const employees = await this.prisma.employee.count({
      where: { tenantId, active: true },
    });

    const records = await this.prisma.attendanceRecord.findMany({
      where: { tenantId, date: today },
    });

    const present = records.filter(
      (r) => r.status === 'PRESENT' || r.status === 'LATE' || r.checkIn,
    ).length;
    const late = records.filter((r) => r.status === 'LATE' || r.lateMin > 0).length;
    const absentMarked = records.filter((r) => r.status === 'ABSENT').length;
    const overtimeMin = records.reduce((s, r) => s + (r.overtimeMin || 0), 0);
    // الغياب = المُعلَّم غياباً صراحةً + من لم يُسجَّل لهم حضور
    const absent = Math.max(absentMarked, employees - present);

    return {
      total: employees,
      present,
      late,
      absent,
      overtimeHours: Math.round((overtimeMin / 60) * 10) / 10,
    };
  }
}
