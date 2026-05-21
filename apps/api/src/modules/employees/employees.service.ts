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

  // ─── العمل الإضافي (Overtime) ───────────────────────────────
  // أجر الساعة الإضافية = (الراتب/26/8) × 1.5
  private overtimeRates(baseSalary: number) {
    const WORKING_DAYS = 26;
    const dailyRate = baseSalary / WORKING_DAYS;
    const hourlyRate = dailyRate / 8;
    const overtimeHourly = hourlyRate * 1.5;
    return { dailyRate, hourlyRate, overtimeHourly };
  }

  /** كشف العمل الإضافي لموظف خلال شهر — السجلات + الإجماليات + قيمة OT */
  async getEmployeeOvertime(tenantId: string, employeeId: string, monthStr?: string) {
    const emp = await this.prisma.employee.findFirst({
      where: { id: employeeId, tenantId },
    });
    if (!emp) throw new NotFoundException('الموظف غير موجود');

    const ref = monthStr ? new Date(monthStr + '-01') : new Date();
    const start = new Date(ref.getFullYear(), ref.getMonth(), 1);
    const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 1);
    const round = (n: number) => Math.round(n * 100) / 100;

    const records = await this.prisma.attendanceRecord.findMany({
      where: { tenantId, employeeId, date: { gte: start, lt: end }, overtimeMin: { gt: 0 } },
      orderBy: { date: 'desc' },
    });

    const base = Number(emp.baseSalary ?? 0);
    const { overtimeHourly, hourlyRate } = this.overtimeRates(base);
    const totalMin = records.reduce((s, r) => s + (r.overtimeMin || 0), 0);
    const totalHours = totalMin / 60;

    return {
      employeeId: emp.id,
      employeeName: emp.fullName,
      month: start.toISOString().slice(0, 7),
      baseSalary: round(base),
      hourlyRate: round(hourlyRate),
      overtimeHourlyRate: round(overtimeHourly),
      totalHours: round(totalHours),
      totalValue: round(totalHours * overtimeHourly),
      entries: records.map((r) => ({
        id: r.id,
        date: r.date,
        hours: round((r.overtimeMin || 0) / 60),
        minutes: r.overtimeMin || 0,
        value: round(((r.overtimeMin || 0) / 60) * overtimeHourly),
        notes: r.notes ?? null,
      })),
    };
  }

  /** إضافة/تعيين ساعات عمل إضافي ليوم محدد (تعيين القيمة، وليس الإضافة) */
  async addOvertimeForDate(
    tenantId: string,
    employeeId: string,
    data: { date?: string; hours: number; notes?: string },
  ) {
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId, tenantId } });
    if (!emp) throw new NotFoundException('الموظف غير موجود');

    const hours = Number(data.hours);
    if (!(hours > 0)) throw new BadRequestException('عدد الساعات غير صحيح');
    const overtimeMin = Math.round(hours * 60);

    const day = data.date ? new Date(data.date) : new Date();
    day.setHours(0, 0, 0, 0);

    const existing = await this.prisma.attendanceRecord.findFirst({
      where: { employeeId, date: day },
    });

    if (existing) {
      return this.prisma.attendanceRecord.update({
        where: { id: existing.id },
        data: { overtimeMin, ...(data.notes !== undefined ? { notes: data.notes } : {}) },
      });
    }

    return this.prisma.attendanceRecord.create({
      data: {
        tenantId,
        employeeId,
        date: day,
        status: 'PRESENT',
        overtimeMin,
        notes: data.notes ?? null,
      },
    });
  }

  /** تعديل سجل عمل إضافي (تعيين عدد الساعات / ملاحظات) */
  async updateOvertimeEntry(
    tenantId: string,
    recordId: string,
    data: { hours?: number; notes?: string },
  ) {
    const rec = await this.prisma.attendanceRecord.findFirst({
      where: { id: recordId, tenantId },
    });
    if (!rec) throw new NotFoundException('السجل غير موجود');

    const patch: any = {};
    if (data.hours !== undefined) {
      const hours = Number(data.hours);
      if (hours < 0) throw new BadRequestException('عدد الساعات غير صحيح');
      patch.overtimeMin = Math.round(hours * 60);
    }
    if (data.notes !== undefined) patch.notes = data.notes;

    return this.prisma.attendanceRecord.update({
      where: { id: recordId },
      data: patch,
    });
  }

  /** حذف العمل الإضافي من سجل (تصفير الساعات فقط، دون حذف الحضور) */
  async deleteOvertimeEntry(tenantId: string, recordId: string) {
    const rec = await this.prisma.attendanceRecord.findFirst({
      where: { id: recordId, tenantId },
    });
    if (!rec) throw new NotFoundException('السجل غير موجود');

    return this.prisma.attendanceRecord.update({
      where: { id: recordId },
      data: { overtimeMin: 0 },
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
    const monthKey = start.toISOString().slice(0, 7);
    const WORKING_DAYS = 26;
    const round = (n: number) => Math.round(n * 100) / 100;

    const [employees, records, adjustments] = await Promise.all([
      this.prisma.employee.findMany({ where: { tenantId, active: true } }),
      this.prisma.attendanceRecord.findMany({
        where: { tenantId, date: { gte: start, lt: end } },
      }),
      this.prisma.payrollAdjustment.findMany({
        where: { tenantId, month: monthKey },
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

    const adjByEmp = new Map(adjustments.map((a) => [a.employeeId, a]));

    const rows = employees.map((emp) => {
      const base = Number(emp.baseSalary ?? 0);
      const s = byEmp.get(emp.id) ?? { present: 0, absent: 0, lateMin: 0, overtimeMin: 0 };
      const dailyRate = base / WORKING_DAYS;
      const hourlyRate = dailyRate / 8;
      const absenceDeduction = s.absent * dailyRate;
      const lateDeduction = (s.lateMin / 60) * hourlyRate;
      const overtimePay = (s.overtimeMin / 60) * hourlyRate * 1.5;
      // الصافي المحسوب تلقائياً (قبل التعديلات اليدوية)
      const computedNet = base - absenceDeduction - lateDeduction + overtimePay;

      // ── التعديلات اليدوية ──
      const adj = adjByEmp.get(emp.id);
      const bonus = Number(adj?.bonus ?? 0);
      const manualDeduction = Number(adj?.deduction ?? 0);
      const overrideNet = adj?.overrideNet != null ? Number(adj.overrideNet) : null;
      const net = overrideNet != null ? overrideNet : computedNet + bonus - manualDeduction;

      return {
        employeeId: emp.id,
        code: emp.code,
        fullName: emp.fullName,
        department: emp.department,
        position: emp.position,
        baseSalary: round(base),
        dailyRate: round(dailyRate),
        hourlyRate: round(hourlyRate),
        presentDays: s.present,
        absentDays: s.absent,
        lateHours: round(s.lateMin / 60),
        overtimeHours: round(s.overtimeMin / 60),
        absenceDeduction: round(absenceDeduction),
        lateDeduction: round(lateDeduction),
        overtimePay: round(overtimePay),
        computedNet: round(computedNet),
        // التعديلات اليدوية
        bonus: round(bonus),
        manualDeduction: round(manualDeduction),
        overrideNet: overrideNet != null ? round(overrideNet) : null,
        notes: adj?.notes ?? null,
        paid: adj?.paid ?? false,
        paidAt: adj?.paidAt ?? null,
        net: round(net),
      };
    });

    const totals = rows.reduce(
      (t, r) => ({
        baseSalary: t.baseSalary + r.baseSalary,
        deductions: t.deductions + r.absenceDeduction + r.lateDeduction + r.manualDeduction,
        bonus: t.bonus + r.bonus,
        overtimePay: t.overtimePay + r.overtimePay,
        net: t.net + r.net,
        paid: t.paid + (r.paid ? r.net : 0),
        unpaid: t.unpaid + (r.paid ? 0 : r.net),
      }),
      { baseSalary: 0, deductions: 0, bonus: 0, overtimePay: 0, net: 0, paid: 0, unpaid: 0 },
    );

    return {
      month: monthKey,
      workingDays: WORKING_DAYS,
      rows,
      totals: {
        baseSalary: round(totals.baseSalary),
        deductions: round(totals.deductions),
        bonus: round(totals.bonus),
        overtimePay: round(totals.overtimePay),
        net: round(totals.net),
        paid: round(totals.paid),
        unpaid: round(totals.unpaid),
      },
    };
  }

  // ─── تعديل راتب الشهر يدوياً (مكافأة/خصم/تجاوز/ملاحظات) ──────
  async savePayrollAdjustment(
    tenantId: string,
    userId: string,
    data: {
      employeeId: string;
      month: string;
      bonus?: number;
      deduction?: number;
      overrideNet?: number | null;
      notes?: string | null;
    },
  ) {
    if (!data.employeeId || !data.month) {
      throw new BadRequestException('الموظف والشهر مطلوبان');
    }
    // تأكد أن الموظف يتبع نفس المنشأة
    const emp = await this.prisma.employee.findFirst({
      where: { id: data.employeeId, tenantId },
    });
    if (!emp) throw new NotFoundException('الموظف غير موجود');

    const bonus = new Prisma.Decimal(Number(data.bonus) || 0);
    const deduction = new Prisma.Decimal(Number(data.deduction) || 0);
    const overrideNet =
      data.overrideNet === null || data.overrideNet === undefined || data.overrideNet === ('' as any)
        ? null
        : new Prisma.Decimal(Number(data.overrideNet));
    const notes = data.notes || null;

    return this.prisma.payrollAdjustment.upsert({
      where: {
        tenantId_employeeId_month: {
          tenantId,
          employeeId: data.employeeId,
          month: data.month,
        },
      },
      update: { bonus, deduction, overrideNet, notes },
      create: {
        tenantId,
        employeeId: data.employeeId,
        month: data.month,
        bonus,
        deduction,
        overrideNet,
        notes,
        createdById: userId,
      },
    });
  }

  /**
   * صرف الرواتب: لموظف واحد أو لكل الموظفين غير المدفوعين في الشهر.
   * يخصم الصافي من الصندوق + يسجّل مصروف (رواتب) + حركة نقدية، ويعلّم السجل مدفوعاً.
   */
  async payPayroll(
    tenantId: string,
    userId: string,
    opts: { month: string; employeeId?: string; cashboxId?: string },
  ) {
    if (!opts.month) throw new BadRequestException('الشهر مطلوب');

    // أعِد حساب الكشف للحصول على الصافي النهائي لكل موظف
    const payroll = await this.getPayroll(tenantId, opts.month);
    const targets = payroll.rows.filter(
      (r) => !r.paid && r.net > 0 && (!opts.employeeId || r.employeeId === opts.employeeId),
    );

    if (targets.length === 0) {
      return { paidCount: 0, totalPaid: 0, message: 'لا توجد رواتب مستحقة للصرف' };
    }

    return this.prisma.$transaction(async (tx) => {
      // حدّد الصندوق: المُرسل، أو الرئيسي (MAIN)، أو أول صندوق نشِط
      let cashboxId: string | null = opts.cashboxId ?? null;
      if (!cashboxId) {
        const cb =
          (await tx.cashbox.findFirst({ where: { tenantId, active: true, code: 'MAIN' } })) ??
          (await tx.cashbox.findFirst({ where: { tenantId, active: true }, orderBy: { code: 'asc' } }));
        cashboxId = cb?.id ?? null;
      }

      let totalPaid = 0;
      let paidCount = 0;

      for (const r of targets) {
        const amount = new Prisma.Decimal(r.net);

        // 1) مصروف بفئة رواتب
        const number = `EXP-${Date.now().toString(36).toUpperCase()}-${paidCount}`;
        const expense = await tx.expense.create({
          data: {
            tenantId,
            number,
            category: 'رواتب',
            amount,
            description: `راتب ${r.fullName} — شهر ${opts.month}`,
            expenseDate: new Date(),
            cashboxId,
            createdById: userId,
          },
        });

        // 2) خصم من الصندوق + حركة نقدية
        if (cashboxId) {
          await tx.cashbox.update({
            where: { id: cashboxId },
            data: { balance: { decrement: amount } },
          });
          await tx.cashMovement.create({
            data: {
              tenantId,
              cashboxId,
              type: 'OUT',
              amount,
              description: `صرف راتب: ${r.fullName} — ${opts.month}`,
              refType: 'Payroll',
              refId: expense.id,
              performedById: userId,
            },
          });
        }

        // 3) علّم السجل مدفوعاً (upsert لأنه قد لا يوجد تعديل سابق)
        await tx.payrollAdjustment.upsert({
          where: {
            tenantId_employeeId_month: {
              tenantId,
              employeeId: r.employeeId,
              month: opts.month,
            },
          },
          update: { paid: true, paidAt: new Date(), cashboxId },
          create: {
            tenantId,
            employeeId: r.employeeId,
            month: opts.month,
            paid: true,
            paidAt: new Date(),
            cashboxId,
            createdById: userId,
          },
        });

        totalPaid += r.net;
        paidCount++;
      }

      return {
        paidCount,
        totalPaid: Math.round(totalPaid * 100) / 100,
        cashboxId,
        message: `تم صرف ${paidCount} راتب بإجمالي ${Math.round(totalPaid * 100) / 100} د.أ`,
      };
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
