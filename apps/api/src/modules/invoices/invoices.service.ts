import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';

/**
 * Invoice service.
 *
 * Persists the official printable invoices (see `apps/web/app/invoices/*`).
 *
 * Rules:
 *   - invoiceNumber is unique per tenant.
 *   - subTotal, discount, and total are recomputed on every save from
 *     the submitted lines — we never trust client-side totals for
 *     financial data.
 *   - Delete performs a hard delete of DRAFT invoices; ISSUED invoices
 *     are moved to CANCELLED status instead of destroyed, so historical
 *     numbering stays intact.
 */
type InvoiceLineInput = {
  qty: number | string | null | undefined;
  description: string;
  unitPrice: number | string | null | undefined;
};

type InvoiceInput = {
  invoiceNumber: string;
  invoiceDate: string;                 // YYYY-MM-DD or ISO
  status?: 'DRAFT' | 'ISSUED' | 'CANCELLED';
  customerId?: string | null;
  customerName: string;
  customerAddress?: string | null;
  customerCity?: string | null;
  customerState?: string | null;
  customerZip?: string | null;
  customerPhone?: string | null;
  currency?: string;
  discount?: number | string;
  paymentMethod?: 'cash' | 'check' | 'debit' | null;
  paymentReference?: string | null;
  origin?: string | null;
  notes?: string | null;
  lines: InvoiceLineInput[];
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List invoices for the tenant with optional search on invoice number
   * or customer name (case-insensitive).
   */
  async list(
    tenantId: string,
    opts: { search?: string; status?: string; limit?: number } = {},
  ) {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const where: any = { tenantId };
    if (opts.status) where.status = opts.status;
    if (opts.search) {
      where.OR = [
        { invoiceNumber: { contains: opts.search, mode: 'insensitive' } },
        { customerName:  { contains: opts.search, mode: 'insensitive' } },
      ];
    }
    return (this.prisma as any).invoice.findMany({
      where,
      orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      include: { lines: { orderBy: { lineOrder: 'asc' } } },
    });
  }

  async get(tenantId: string, id: string) {
    const inv = await (this.prisma as any).invoice.findFirst({
      where: { id, tenantId },
      include: { lines: { orderBy: { lineOrder: 'asc' } } },
    });
    if (!inv) throw new NotFoundException('الفاتورة غير موجودة');
    return inv;
  }

  private computeTotals(input: InvoiceInput) {
    const lines = (input.lines || []).map((l, i) => {
      const qty = num(l.qty);
      const unitPrice = num(l.unitPrice);
      const lineTotal = Math.round(qty * unitPrice * 100) / 100;
      return {
        lineOrder: i,
        qty,
        description: String(l.description ?? ''),
        unitPrice,
        lineTotal,
      };
    });
    const subTotal = Math.round(lines.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100;
    const discount = Math.round(num(input.discount) * 100) / 100;
    const total = Math.max(0, Math.round((subTotal - discount) * 100) / 100);
    return { lines, subTotal, discount, total };
  }

  async create(tenantId: string, userId: string | null, input: InvoiceInput) {
    if (!input.invoiceNumber?.trim()) {
      throw new BadRequestException('رقم الفاتورة مطلوب');
    }
    if (!input.customerName?.trim()) {
      throw new BadRequestException('اسم الزبون مطلوب');
    }
    if (!input.invoiceDate) {
      throw new BadRequestException('تاريخ الفاتورة مطلوب');
    }
    const { lines, subTotal, discount, total } = this.computeTotals(input);

    try {
      return await (this.prisma as any).invoice.create({
        data: {
          tenantId,
          invoiceNumber: input.invoiceNumber.trim(),
          invoiceDate: new Date(input.invoiceDate),
          status: input.status ?? 'DRAFT',
          customerId: input.customerId ?? null,
          customerName: input.customerName.trim(),
          customerAddress: input.customerAddress ?? null,
          customerCity: input.customerCity ?? null,
          customerState: input.customerState ?? null,
          customerZip: input.customerZip ?? null,
          customerPhone: input.customerPhone ?? null,
          currency: input.currency ?? '$',
          subTotal: new Prisma.Decimal(subTotal),
          discount: new Prisma.Decimal(discount),
          total: new Prisma.Decimal(total),
          paymentMethod: input.paymentMethod ?? null,
          paymentReference: input.paymentReference ?? null,
          origin: input.origin ?? null,
          notes: input.notes ?? null,
          createdById: userId,
          updatedById: userId,
          lines: {
            create: lines.map((l) => ({
              lineOrder: l.lineOrder,
              qty: new Prisma.Decimal(l.qty),
              description: l.description,
              unitPrice: new Prisma.Decimal(l.unitPrice),
              lineTotal: new Prisma.Decimal(l.lineTotal),
            })),
          },
        },
        include: { lines: { orderBy: { lineOrder: 'asc' } } },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new BadRequestException(
          `رقم الفاتورة "${input.invoiceNumber}" مستخدم من قبل`,
        );
      }
      throw e;
    }
  }

  async update(
    tenantId: string,
    userId: string | null,
    id: string,
    input: InvoiceInput,
  ) {
    // Ensure it belongs to this tenant.
    await this.get(tenantId, id);
    const { lines, subTotal, discount, total } = this.computeTotals(input);

    return this.prisma.$transaction(async (tx: any) => {
      // Replace lines entirely — simpler and matches the FE editor
      // which sends the full line array back on save.
      await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
      try {
        return await tx.invoice.update({
          where: { id },
          data: {
            invoiceNumber: input.invoiceNumber.trim(),
            invoiceDate: new Date(input.invoiceDate),
            status: input.status,
            customerId: input.customerId ?? null,
            customerName: input.customerName.trim(),
            customerAddress: input.customerAddress ?? null,
            customerCity: input.customerCity ?? null,
            customerState: input.customerState ?? null,
            customerZip: input.customerZip ?? null,
            customerPhone: input.customerPhone ?? null,
            currency: input.currency ?? '$',
            subTotal: new Prisma.Decimal(subTotal),
            discount: new Prisma.Decimal(discount),
            total: new Prisma.Decimal(total),
            paymentMethod: input.paymentMethod ?? null,
            paymentReference: input.paymentReference ?? null,
            origin: input.origin ?? null,
            notes: input.notes ?? null,
            updatedById: userId,
            lines: {
              create: lines.map((l) => ({
                lineOrder: l.lineOrder,
                qty: new Prisma.Decimal(l.qty),
                description: l.description,
                unitPrice: new Prisma.Decimal(l.unitPrice),
                lineTotal: new Prisma.Decimal(l.lineTotal),
              })),
            },
          },
          include: { lines: { orderBy: { lineOrder: 'asc' } } },
        });
      } catch (e: any) {
        if (e?.code === 'P2002') {
          throw new BadRequestException(
            `رقم الفاتورة "${input.invoiceNumber}" مستخدم من قبل`,
          );
        }
        throw e;
      }
    });
  }

  /**
   * DRAFT invoices are deleted outright. ISSUED invoices are moved to
   * CANCELLED so their numbering stays audit-safe.
   */
  async delete(tenantId: string, userId: string | null, id: string) {
    const inv = await this.get(tenantId, id);
    if (inv.status === 'DRAFT') {
      await (this.prisma as any).invoice.delete({ where: { id } });
      return { deleted: true, id };
    }
    return (this.prisma as any).invoice.update({
      where: { id },
      data: { status: 'CANCELLED', updatedById: userId },
    });
  }

  /**
   * Suggests the next invoice number in the site convention `NNN\YYYY`
   * (three digits, backslash, four-digit year). Falls back to `001\YYYY`
   * if nothing found for the current year.
   */
  async nextInvoiceNumber(tenantId: string) {
    const year = new Date().getFullYear();
    const rows = await (this.prisma as any).invoice.findMany({
      where: {
        tenantId,
        invoiceNumber: { endsWith: `\\${year}` },
      },
      select: { invoiceNumber: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    let maxSeq = 0;
    for (const r of rows) {
      const m = r.invoiceNumber.match(/^(\d+)\\(\d{4})$/);
      if (m && Number(m[2]) === year) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
      }
    }
    const next = String(maxSeq + 1).padStart(3, '0');
    return { suggested: `${next}\\${year}` };
  }
}
