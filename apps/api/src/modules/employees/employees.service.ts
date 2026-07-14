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
    // JOD payroll: 3 عشريات، قواعد تقريب موحّدة
    const round = (n: number) => Math.round(n * 1000) / 1000;

    // ─── جلب إعدادات المستأجر (SS basis + rates) ─
    const settings = await this.prisma.tenantSetting.findUnique({
      where: { tenantId },
    }).catch(() => null);
    const ssBasis = (settings?.socialSecurityBasis ?? 'BASIC') as 'BASIC' | 'BASIC_PLUS_TRANSPORT' | 'GROSS';
    const empSSRate = settings ? Number(settings.employeeSSRate) : 0.075;
    const compSSRate = settings ? Number(settings.companySSRate) : 0.1425;

    const [employees, records, adjustments, activeAdvances, installments] = await Promise.all([
      this.prisma.employee.findMany({ where: { tenantId, active: true } }),
      this.prisma.attendanceRecord.findMany({
        where: { tenantId, date: { gte: start, lt: end } },
      }),
      this.prisma.payrollAdjustment.findMany({
        where: { tenantId, month: monthKey },
      }),
      this.prisma.employeeAdvance.findMany({
        where: { tenantId, status: 'ACTIVE' },
      }).catch(() => [] as any[]),
      this.prisma.advanceInstallment.findMany({
        where: { tenantId, month: monthKey },
      }).catch(() => [] as any[]),
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
    // خريطة السلف الفعّالة لكل موظف مع رصيد متبقٍ
    const advancesByEmp = new Map<string, any[]>();
    for (const a of activeAdvances) {
      const list = advancesByEmp.get(a.employeeId) ?? [];
      list.push(a);
      advancesByEmp.set(a.employeeId, list);
    }
    // خريطة السلف المخصومة هذا الشهر (لتفادي الخصم المكرر)
    const installmentByAdvance = new Map(installments.map((i) => [i.advanceId, i]));

    const rows = employees.map((emp) => {
      const base = Number(emp.baseSalary ?? 0);
      const s = byEmp.get(emp.id) ?? { present: 0, absent: 0, lateMin: 0, overtimeMin: 0 };
      const dailyRate = base / WORKING_DAYS;
      const hourlyRate = dailyRate / 8;
      const absenceDeduction = s.absent * dailyRate;
      const lateDeduction = (s.lateMin / 60) * hourlyRate;
      const overtimePayAuto = (s.overtimeMin / 60) * hourlyRate * 1.5;

      const adj = adjByEmp.get(emp.id);

      // ── بدل مواصلات ──
      const transportDefault = Number((emp as any).transportAllowance ?? 0);
      const transport =
        adj && (adj as any).transportOverride != null
          ? Number((adj as any).transportOverride)
          : transportDefault;

      // ── أجر إضافي: إذا فيه تجاوز يدوي نأخذه، وإلا الحساب التلقائي + مكافأة ──
      const overtimeAmount =
        adj && (adj as any).overtimeAmount != null
          ? Number((adj as any).overtimeAmount)
          : overtimePayAuto + Number(adj?.bonus ?? 0);

      // ── الإجمالي (Gross): أساسي + إضافي + مواصلات ──
      const grossSalary = base + overtimeAmount + transport;

      // ── أساس الضمان حسب الإعداد ──
      const ssBase =
        ssBasis === 'GROSS' ? grossSalary
        : ssBasis === 'BASIC_PLUS_TRANSPORT' ? base + transport
        : base;
      const employeeSSAuto = ssBase * empSSRate;
      const companySS = ssBase * compSSRate;
      // السماح بتجاوز يدوي للضمان (صلاحية مُدار عليها من الـ controller)
      const employeeSS = adj && (adj as any).employeeSSOverride != null
        ? Number((adj as any).employeeSSOverride)
        : employeeSSAuto;

      // ── سلف الموظفين: قسط الشهر ──
      let advanceDeduction = 0;
      const advanceDetails: Array<{ id: string; installment: number; remaining: number }> = [];
      for (const adv of advancesByEmp.get(emp.id) ?? []) {
        // إذا الشهر أقدم من startMonth نتجاهله
        if (String(adv.startMonth) > monthKey) continue;
        const remaining = Number(adv.amount) - Number(adv.paidAmount);
        if (remaining <= 0) continue;
        // إذا كان القسط مخصوم هذا الشهر مسبقاً نأخذ قيمته من السجل
        const already = installmentByAdvance.get(adv.id);
        const installmentAmt = already
          ? Number(already.amount)
          : Math.min(Number(adv.installmentAmount), remaining);
        advanceDeduction += installmentAmt;
        advanceDetails.push({ id: adv.id, installment: installmentAmt, remaining });
      }

      // ── خصم الدوام (مُجمَّع): غياب + تأخير + خصم يدوي ──
      const attendanceDeduction = absenceDeduction + lateDeduction + Number(adj?.deduction ?? 0);

      // ── صافي الاقتطاعات: ضمان الموظف + سلف + خصم دوام + خصومات أخرى معتمدة ──
      const extraDeductions = Number((adj as any)?.extraDeductions ?? 0);
      const totalDeductions = employeeSS + advanceDeduction + attendanceDeduction + extraDeductions;

      // ── صافي الراتب: إجمالي − اقتطاعات ──
      const overrideNet = adj?.overrideNet != null ? Number(adj.overrideNet) : null;
      const netSalary = overrideNet != null ? overrideNet : grossSalary - totalDeductions;

      // تكلفة الشركة الكلية = Gross + Company SS (الموظف SS جزء من Gross)
      const totalCompanyCost = grossSalary + companySS;

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

        // ─── الحقول المحاسبية المطلوبة ─
        transportAllowance: round(transport),
        overtimeAmount: round(overtimeAmount),
        grossSalary: round(grossSalary),

        ssBase: round(ssBase),
        ssBasis,
        employeeSSRate: empSSRate,
        companySSRate: compSSRate,
        employeeSS: round(employeeSS),
        companySS: round(companySS),

        advanceDeduction: round(advanceDeduction),
        advanceDetails,

        attendanceDeduction: round(attendanceDeduction),
        // تفصيل خصم الدوام (لمودال التفاصيل)
        absenceDeduction: round(absenceDeduction),
        lateDeduction: round(lateDeduction),
        manualAttendancePenalty: round(Number(adj?.deduction ?? 0)),

        extraDeductions: round(extraDeductions),
        totalDeductions: round(totalDeductions),
        netSalary: round(netSalary),
        totalCompanyCost: round(totalCompanyCost),

        // ── حقول للتوافق الرجعي مع الشاشات القديمة ──
        bonus: round(Number(adj?.bonus ?? 0)),
        manualDeduction: round(Number(adj?.deduction ?? 0)),
        overtimePay: round(overtimePayAuto),
        overrideNet: overrideNet != null ? round(overrideNet) : null,
        computedNet: round(grossSalary - attendanceDeduction),
        net: round(netSalary),

        notes: adj?.notes ?? null,
        paid: adj?.paid ?? false,
        paidAt: adj?.paidAt ?? null,
      };
    });

    const totals = rows.reduce(
      (t, r) => ({
        baseSalary: t.baseSalary + r.baseSalary,
        transportAllowance: t.transportAllowance + r.transportAllowance,
        overtimeAmount: t.overtimeAmount + r.overtimeAmount,
        grossSalary: t.grossSalary + r.grossSalary,
        employeeSS: t.employeeSS + r.employeeSS,
        companySS: t.companySS + r.companySS,
        advanceDeduction: t.advanceDeduction + r.advanceDeduction,
        attendanceDeduction: t.attendanceDeduction + r.attendanceDeduction,
        totalDeductions: t.totalDeductions + r.totalDeductions,
        net: t.net + r.netSalary,
        paid: t.paid + (r.paid ? r.netSalary : 0),
        unpaid: t.unpaid + (r.paid ? 0 : r.netSalary),
        // legacy
        deductions: t.deductions + r.absenceDeduction + r.lateDeduction + r.manualDeduction,
        bonus: t.bonus + r.bonus,
        overtimePay: t.overtimePay + r.overtimePay,
      }),
      {
        baseSalary: 0, transportAllowance: 0, overtimeAmount: 0, grossSalary: 0,
        employeeSS: 0, companySS: 0, advanceDeduction: 0, attendanceDeduction: 0,
        totalDeductions: 0, net: 0, paid: 0, unpaid: 0,
        deductions: 0, bonus: 0, overtimePay: 0,
      },
    );

    return {
      month: monthKey,
      workingDays: WORKING_DAYS,
      settings: { socialSecurityBasis: ssBasis, employeeSSRate: empSSRate, companySSRate: compSSRate },
      rows,
      totals: {
        baseSalary: round(totals.baseSalary),
        transportAllowance: round(totals.transportAllowance),
        overtimeAmount: round(totals.overtimeAmount),
        grossSalary: round(totals.grossSalary),
        employeeSS: round(totals.employeeSS),
        companySS: round(totals.companySS),
        advanceDeduction: round(totals.advanceDeduction),
        attendanceDeduction: round(totals.attendanceDeduction),
        totalDeductions: round(totals.totalDeductions),
        net: round(totals.net),
        paid: round(totals.paid),
        unpaid: round(totals.unpaid),
        // إجمالي تكلفة الرواتب على الشركة = Gross + Company SS
        totalCompanyCost: round(totals.grossSalary + totals.companySS),
        // legacy
        deductions: round(totals.deductions),
        bonus: round(totals.bonus),
        overtimePay: round(totals.overtimePay),
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

  // ─── وثائق الموظف ────────────────────────────────
  async listDocuments(tenantId: string, employeeId: string) {
    const list = await this.prisma.employeeDocument.findMany({
      where: { tenantId, employeeId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, docType: true, title: true, fileName: true, mimeType: true,
        fileUrl: true, description: true, createdAt: true, createdById: true,
      },
    });
    // لا نُرجع الـ fileData في القائمة لأنها كبيرة
    return list;
  }

  async getDocument(tenantId: string, id: string) {
    const doc = await this.prisma.employeeDocument.findFirst({
      where: { id, tenantId },
    });
    if (!doc) throw new NotFoundException('الوثيقة غير موجودة');
    return doc;
  }

  async createDocument(tenantId: string, userId: string, employeeId: string, data: any) {
    if (!data.title?.trim()) throw new BadRequestException('العنوان مطلوب');
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId, tenantId } });
    if (!emp) throw new NotFoundException('الموظف غير موجود');
    const doc = await this.prisma.employeeDocument.create({
      data: {
        tenantId,
        employeeId,
        docType: data.docType || 'OTHER',
        title: data.title.trim(),
        fileName: data.fileName ?? null,
        mimeType: data.mimeType ?? null,
        fileData: data.fileData ?? null,
        fileUrl: data.fileUrl ?? null,
        description: data.description ?? null,
        createdById: userId,
      },
      select: {
        id: true, docType: true, title: true, fileName: true, mimeType: true,
        fileUrl: true, description: true, createdAt: true, createdById: true,
      },
    });
    return doc;
  }

  async deleteDocument(tenantId: string, id: string) {
    const doc = await this.prisma.employeeDocument.findFirst({ where: { id, tenantId } });
    if (!doc) throw new NotFoundException();
    await this.prisma.employeeDocument.delete({ where: { id } });
    return { ok: true };
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
