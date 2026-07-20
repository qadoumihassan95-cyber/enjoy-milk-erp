/**
 * Regression tests for the attendance bug where clicking "حضور / Present"
 * silently also marked the employee as "تأخير / Late" (based on wall-clock
 * comparison to shift start).
 *
 * Contract under test:
 *   1) checkIn(...) ALWAYS creates the record with status = 'PRESENT' and
 *      lateMin = 0, no matter what time of day it is called.
 *   2) checkIn(...) called a second time (when a checkIn exists but no
 *      checkOut) performs a check-out and does NOT change status.
 *   3) markAttendance({ status: 'LATE' }) sets status = 'LATE' and does
 *      NOT trigger any PRESENT-only side effect.
 *   4) The Present and Late flows are fully independent — clicking one
 *      never touches the other's counters.
 *
 * This suite uses a hand-rolled Prisma mock so it runs anywhere (no DB
 * required). Any future refactor that re-introduces the auto-late-by-
 * clock behaviour will break test #1 immediately.
 */

import { EmployeesService } from './employees.service';

type Rec = {
  id: string;
  tenantId: string;
  employeeId: string;
  date: Date;
  checkIn: Date | null;
  checkOut: Date | null;
  lateMin: number;
  overtimeMin: number;
  status: 'PRESENT' | 'LATE' | 'ABSENT' | 'LEAVE' | 'HALF_DAY';
};

function makePrismaMock() {
  const rows: Rec[] = [];
  let idSeq = 1;
  const attendanceRecord = {
    findFirst: jest.fn(async ({ where }: any) => {
      return rows.find(
        (r) =>
          r.employeeId === where.employeeId &&
          r.date.getTime() === (where.date as Date).getTime(),
      ) ?? null;
    }),
    create: jest.fn(async ({ data }: any) => {
      const rec: Rec = {
        id: 'a' + idSeq++,
        overtimeMin: 0,
        lateMin: 0,
        checkOut: null,
        ...data,
      };
      rows.push(rec);
      return rec;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const rec = rows.find((r) => r.id === where.id);
      if (!rec) throw new Error('not found');
      Object.assign(rec, data);
      return rec;
    }),
    findMany: jest.fn(async () => rows),
  };
  return { attendanceRecord, __rows: rows };
}

function makeService(prisma: any) {
  // The service constructor takes (prisma) — instantiate it directly.
  return new (EmployeesService as any)(prisma) as EmployeesService;
}

describe('Attendance — Present click must never mark Late', () => {
  const tenantId = 't1';
  const employeeId = 'e1';

  it('checkIn at 08:00 sharp stores PRESENT with lateMin=0', async () => {
    const prisma = makePrismaMock();
    const svc = makeService(prisma);
    // Freeze wall-clock at 08:00
    jest.useFakeTimers().setSystemTime(new Date('2026-07-19T08:00:00'));
    await svc.checkIn(tenantId, employeeId);
    const [rec] = prisma.__rows;
    expect(rec.status).toBe('PRESENT');
    expect(rec.lateMin).toBe(0);
    jest.useRealTimers();
  });

  it('checkIn at 10:30 (well after shift start) STILL stores PRESENT with lateMin=0', async () => {
    const prisma = makePrismaMock();
    const svc = makeService(prisma);
    // Regression: prior code auto-flipped this to LATE with lateMin=145
    jest.useFakeTimers().setSystemTime(new Date('2026-07-19T10:30:00'));
    await svc.checkIn(tenantId, employeeId);
    const [rec] = prisma.__rows;
    expect(rec.status).toBe('PRESENT');
    expect(rec.lateMin).toBe(0);
    expect(rec.checkOut).toBeNull();
    jest.useRealTimers();
  });

  it('checkIn twice on the same day performs check-out WITHOUT touching status', async () => {
    const prisma = makePrismaMock();
    const svc = makeService(prisma);
    // Seed one PRESENT check-in earlier
    jest.useFakeTimers().setSystemTime(new Date('2026-07-19T08:15:00'));
    await svc.checkIn(tenantId, employeeId);
    // Second click at end of day → check-out
    jest.setSystemTime(new Date('2026-07-19T17:00:00'));
    await svc.checkIn(tenantId, employeeId);
    const [rec] = prisma.__rows;
    expect(rec.status).toBe('PRESENT'); // must NOT have flipped to LATE
    expect(rec.checkOut).toBeInstanceOf(Date);
    jest.useRealTimers();
  });

  it('markAttendance({status:"LATE"}) sets LATE — Present flow is untouched', async () => {
    const prisma = makePrismaMock();
    const svc = makeService(prisma);
    await svc.markAttendance(tenantId, employeeId, { status: 'LATE' });
    const [rec] = prisma.__rows;
    expect(rec.status).toBe('LATE');
    // Present-side effect must NOT have fired: no double-record was created
    expect(prisma.__rows).toHaveLength(1);
  });

  it('markAttendance({status:"LATE"}) on top of PRESENT flips to LATE, preserves checkIn', async () => {
    const prisma = makePrismaMock();
    const svc = makeService(prisma);
    jest.useFakeTimers().setSystemTime(new Date('2026-07-19T08:00:00'));
    await svc.checkIn(tenantId, employeeId);
    const checkInTime = prisma.__rows[0].checkIn;
    jest.setSystemTime(new Date('2026-07-19T09:00:00'));
    await svc.markAttendance(tenantId, employeeId, { status: 'LATE' });
    const rec = prisma.__rows[0];
    expect(rec.status).toBe('LATE');
    expect(rec.checkIn).toEqual(checkInTime); // original checkIn preserved
    jest.useRealTimers();
  });

  it('Present count is independent of Late count', async () => {
    const prisma = makePrismaMock();
    const svc = makeService(prisma);
    // Employee A → Present
    jest.useFakeTimers().setSystemTime(new Date('2026-07-19T09:30:00'));
    await svc.checkIn(tenantId, 'A');
    // Employee B → Late
    await svc.markAttendance(tenantId, 'B', { status: 'LATE' });
    const presents = prisma.__rows.filter((r) => r.status === 'PRESENT').length;
    const lates = prisma.__rows.filter((r) => r.status === 'LATE').length;
    expect(presents).toBe(1);
    expect(lates).toBe(1);
    // Employee A's record has ZERO lateMin — no payroll deduction possible
    const a = prisma.__rows.find((r) => r.employeeId === 'A')!;
    expect(a.lateMin).toBe(0);
    jest.useRealTimers();
  });
});
