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
