import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TelegramService } from './telegram.service';

/**
 * إدارة حسابات/بوتات Telegram المتعددة.
 * - تخزين آمن للتوكن (لا يُرجَع كاملاً عبر الـ API — يُحجب)
 * - تسجيل/حذف webhook لكل حساب
 * - اختبار الاتصال، إعادة الربط، تعطيل/تفعيل
 * - سجلّ عمليات (TelegramLog)
 */
@Injectable()
export class TelegramAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
  ) {}

  private genSecret(): string {
    return randomBytes(24).toString('hex'); // [0-9a-f] — مقبول لدى Telegram
  }

  private maskToken(token?: string | null): string {
    if (!token) return '';
    const t = String(token);
    if (t.length <= 8) return '••••';
    return `••••${t.slice(-6)}`;
  }

  /** يحجب التوكن قبل الإرجاع للواجهة */
  private sanitize(acc: any) {
    if (!acc) return acc;
    const { token, webhookSecret, ...rest } = acc;
    return { ...rest, tokenMasked: this.maskToken(token), hasToken: Boolean(token) };
  }

  private async log(
    tenantId: string,
    accountId: string | null,
    action: string,
    success: boolean,
    error?: string,
    direction: string = 'SYSTEM',
  ) {
    try {
      await this.prisma.telegramLog.create({
        data: { tenantId, accountId, action, success, error: error ?? null, direction },
      });
    } catch {
      /* لا تُفشل العملية بسبب السجلّ */
    }
  }

  // ─── List / Get ───────────────────────────────────
  async list(tenantId: string) {
    const accounts = await this.prisma.telegramAccount.findMany({
      where: { tenantId, active: true },
      orderBy: { createdAt: 'desc' },
    });
    return accounts.map((a) => this.sanitize(a));
  }

  async get(tenantId: string, id: string) {
    const acc = await this.prisma.telegramAccount.findFirst({ where: { id, tenantId } });
    if (!acc) throw new NotFoundException('الحساب غير موجود');
    return this.sanitize(acc);
  }

  /** للاستخدام الداخلي (webhook) — يرجع الحساب بالتوكن الكامل */
  async findForWebhook(id: string) {
    return this.prisma.telegramAccount.findUnique({ where: { id } });
  }

  // ─── Create ───────────────────────────────────────
  async create(tenantId: string, userId: string, data: any) {
    const token = (data.token || '').trim();
    if (!token) throw new BadRequestException('Bot Token مطلوب');
    if (!data.name?.trim()) throw new BadRequestException('اسم الحساب مطلوب');

    // اختبر التوكن قبل الحفظ
    const me = await this.telegram.testToken(token);
    const valid = Boolean(me?.ok);
    const webhookSecret = this.genSecret();

    const account = await this.prisma.telegramAccount.create({
      data: {
        tenantId,
        name: data.name.trim(),
        token,
        chatId: data.chatId || null,
        username: data.username || null,
        botUsername: valid ? me.result?.username ?? null : null,
        phone: data.phone || null,
        accountType: data.accountType || 'BOT',
        role: (data.role as any) || 'VIEWER',
        status: valid ? 'CONNECTED' : 'ERROR',
        webhookSecret,
        notes: data.notes || null,
        lastSyncAt: valid ? new Date() : null,
        lastError: valid ? null : me?.description || 'token غير صالح',
        createdById: userId,
      },
    });

    // سجّل webhook إن كان التوكن صحيحاً
    if (valid) {
      const wh = await this.telegram.setWebhookForAccount(account);
      await this.prisma.telegramAccount.update({
        where: { id: account.id },
        data: { webhookSet: wh.ok, status: wh.ok ? 'CONNECTED' : 'DISCONNECTED' },
      });
      await this.log(tenantId, account.id, `إضافة حساب: ${account.name}`, wh.ok, wh.ok ? undefined : 'فشل تسجيل webhook');
    } else {
      await this.log(tenantId, account.id, `إضافة حساب (توكن غير صالح): ${account.name}`, false, account.lastError ?? undefined);
    }

    return this.get(tenantId, account.id);
  }

  // ─── Update ───────────────────────────────────────
  async update(tenantId: string, id: string, data: any) {
    const existing = await this.prisma.telegramAccount.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('الحساب غير موجود');

    const patch: any = {};
    if (data.name !== undefined) patch.name = data.name.trim() || existing.name;
    if (data.chatId !== undefined) patch.chatId = data.chatId || null;
    if (data.username !== undefined) patch.username = data.username || null;
    if (data.phone !== undefined) patch.phone = data.phone || null;
    if (data.accountType !== undefined) patch.accountType = data.accountType;
    if (data.role !== undefined) patch.role = data.role;
    if (data.notes !== undefined) patch.notes = data.notes || null;

    // تغيير التوكن → إعادة اختبار + إعادة تسجيل webhook
    const tokenChanged = data.token && data.token.trim() && data.token.trim() !== existing.token;
    if (tokenChanged) {
      const newToken = data.token.trim();
      const me = await this.telegram.testToken(newToken);
      patch.token = newToken;
      patch.status = me?.ok ? 'CONNECTED' : 'ERROR';
      patch.botUsername = me?.ok ? me.result?.username ?? null : existing.botUsername;
      patch.lastError = me?.ok ? null : me?.description || 'token غير صالح';
      patch.lastSyncAt = me?.ok ? new Date() : existing.lastSyncAt;
    }

    await this.prisma.telegramAccount.update({ where: { id }, data: patch });

    if (tokenChanged && patch.status === 'CONNECTED') {
      const acc = await this.prisma.telegramAccount.findUnique({ where: { id } });
      if (acc) {
        const wh = await this.telegram.setWebhookForAccount(acc);
        await this.prisma.telegramAccount.update({
          where: { id },
          data: { webhookSet: wh.ok, status: wh.ok ? 'CONNECTED' : 'DISCONNECTED' },
        });
      }
    }

    await this.log(tenantId, id, `تعديل حساب: ${patch.name ?? existing.name}`, true);
    return this.get(tenantId, id);
  }

  // ─── Test connection ──────────────────────────────
  async test(tenantId: string, id: string) {
    const acc = await this.prisma.telegramAccount.findFirst({ where: { id, tenantId } });
    if (!acc) throw new NotFoundException('الحساب غير موجود');

    const me = await this.telegram.testToken(acc.token);
    const ok = Boolean(me?.ok);
    await this.prisma.telegramAccount.update({
      where: { id },
      data: {
        status: ok ? 'CONNECTED' : 'ERROR',
        botUsername: ok ? me.result?.username ?? acc.botUsername : acc.botUsername,
        lastSyncAt: ok ? new Date() : acc.lastSyncAt,
        lastError: ok ? null : me?.description || 'فشل الاتصال',
      },
    });
    await this.log(tenantId, id, 'اختبار الاتصال', ok, ok ? undefined : me?.description);
    return {
      ok,
      botUsername: ok ? me.result?.username : null,
      description: ok ? 'الاتصال ناجح' : me?.description || 'فشل الاتصال',
    };
  }

  // ─── Reconnect (re-register webhook) ──────────────
  async reconnect(tenantId: string, id: string) {
    const acc = await this.prisma.telegramAccount.findFirst({ where: { id, tenantId } });
    if (!acc) throw new NotFoundException('الحساب غير موجود');

    const wh = await this.telegram.setWebhookForAccount(acc);
    await this.prisma.telegramAccount.update({
      where: { id },
      data: {
        webhookSet: wh.ok,
        status: wh.ok ? 'CONNECTED' : 'DISCONNECTED',
        lastSyncAt: wh.ok ? new Date() : acc.lastSyncAt,
        lastError: wh.ok ? null : wh.raw?.description || 'فشل إعادة الربط',
      },
    });
    await this.log(tenantId, id, 'إعادة الربط (webhook)', wh.ok, wh.ok ? undefined : wh.raw?.description);
    return { ok: wh.ok, url: wh.url, description: wh.ok ? 'تم إعادة الربط' : wh.raw?.description };
  }

  // ─── Disable / Enable ─────────────────────────────
  async disable(tenantId: string, id: string) {
    const acc = await this.prisma.telegramAccount.findFirst({ where: { id, tenantId } });
    if (!acc) throw new NotFoundException('الحساب غير موجود');
    await this.telegram.deleteWebhookForToken(acc.token);
    await this.prisma.telegramAccount.update({
      where: { id },
      data: { status: 'DISABLED', webhookSet: false },
    });
    await this.log(tenantId, id, 'تعطيل الحساب', true);
    return { ok: true };
  }

  async enable(tenantId: string, id: string) {
    const acc = await this.prisma.telegramAccount.findFirst({ where: { id, tenantId } });
    if (!acc) throw new NotFoundException('الحساب غير موجود');
    const wh = await this.telegram.setWebhookForAccount(acc);
    await this.prisma.telegramAccount.update({
      where: { id },
      data: { status: wh.ok ? 'CONNECTED' : 'DISCONNECTED', webhookSet: wh.ok },
    });
    await this.log(tenantId, id, 'تفعيل الحساب', wh.ok);
    return { ok: wh.ok };
  }

  // ─── Delete (soft) ────────────────────────────────
  async remove(tenantId: string, id: string) {
    const acc = await this.prisma.telegramAccount.findFirst({ where: { id, tenantId } });
    if (!acc) throw new NotFoundException('الحساب غير موجود');
    await this.telegram.deleteWebhookForToken(acc.token).catch(() => undefined);
    await this.prisma.telegramAccount.update({
      where: { id },
      data: { active: false, status: 'DISABLED', webhookSet: false },
    });
    await this.log(tenantId, id, `حذف حساب: ${acc.name}`, true);
    return { ok: true };
  }

  // ─── Logs ─────────────────────────────────────────
  async logs(
    tenantId: string,
    opts: { accountId?: string; direction?: string; q?: string } = {},
  ) {
    return this.prisma.telegramLog.findMany({
      where: {
        tenantId,
        ...(opts.accountId ? { accountId: opts.accountId } : {}),
        ...(opts.direction ? { direction: opts.direction } : {}),
        ...(opts.q ? { action: { contains: opts.q, mode: 'insensitive' } } : {}),
      },
      include: { account: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
