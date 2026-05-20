import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../core/prisma/prisma.service';

/**
 * Telegram Bot Service — Webhook-based, production-ready for Render.
 *
 * البيئة (Environment Variables):
 *   TELEGRAM_BOT_TOKEN        توكن البوت من @BotFather (سري)
 *   TELEGRAM_WEBHOOK_SECRET   سر للتحقق من أن التحديثات قادمة من Telegram فعلاً
 *   TELEGRAM_ALLOWED_CHAT_IDS قائمة معرّفات الدردشة المسموح لها (مفصولة بفواصل) — اختياري
 *   PUBLIC_API_URL            عنوان الـ API العام (مثل https://enjoymilk-api.onrender.com)
 *                             يُستخدم لتسجيل الـ webhook تلقائياً عند الإقلاع
 *
 * الأوامر المدعومة:
 *   /start        رسالة ترحيب
 *   /help         قائمة الأوامر
 *   /production   تقرير إنتاج اليوم
 *   /stock        الأصناف منخفضة المخزون
 *   /orders       الطلبيات غير المدفوعة
 *   /balance      رصيد المستودع (حليب/كرتون/ألمنيوم)
 */
@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private readonly token: string;
  private readonly webhookSecret: string;
  private readonly publicApiUrl: string;
  private readonly allowedChatIds: Set<string>;
  private readonly apiBase: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    // trim() يزيل أي مسافات/أسطر زائدة قد تُلصق مع التوكن (سبب شائع لـ 401)
    this.token = (this.config.get<string>('TELEGRAM_BOT_TOKEN') ?? '').trim();
    // Telegram يقبل في secret_token فقط [A-Za-z0-9_-]. نزيل أي أحرف أخرى
    // (مثل / و = و + التي يولّدها Render في القيم base64) — لتفادي خطأ 400.
    this.webhookSecret = (this.config.get<string>('TELEGRAM_WEBHOOK_SECRET') ?? '')
      .trim()
      .replace(/[^A-Za-z0-9_-]/g, '');
    // PUBLIC_API_URL أو RENDER_EXTERNAL_URL (يحقنه Render تلقائياً) — لتسجيل الـ webhook
    this.publicApiUrl = (
      this.config.get<string>('PUBLIC_API_URL') ??
      this.config.get<string>('RENDER_EXTERNAL_URL') ??
      ''
    ).replace(/\/$/, '');
    const allowed = this.config.get<string>('TELEGRAM_ALLOWED_CHAT_IDS') ?? '';
    this.allowedChatIds = new Set(
      allowed
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
    this.apiBase = `https://api.telegram.org/bot${this.token}`;
  }

  get isEnabled(): boolean {
    return Boolean(this.token);
  }

  /** التحقق من سر الـ webhook (يُرسله Telegram في رأس الطلب) */
  verifySecret(headerSecret?: string): boolean {
    // إذا لم يُضبط سر، نقبل (لكن نسجّل تحذيراً). الأفضل دائماً ضبطه.
    if (!this.webhookSecret) return true;
    return headerSecret === this.webhookSecret;
  }

  // ─── Auto-register webhook on startup ─────────────────────────
  async onModuleInit() {
    if (!this.isEnabled) {
      this.logger.warn(
        'TELEGRAM_BOT_TOKEN غير مضبوط — بوت Telegram معطّل (النظام يعمل طبيعياً بدونه).',
      );
      return;
    }
    if (!this.publicApiUrl) {
      this.logger.warn(
        'PUBLIC_API_URL غير مضبوط — لن يُسجَّل الـ webhook تلقائياً. سجّله يدوياً عبر GET /api/telegram/setup',
      );
      return;
    }
    try {
      await this.registerWebhook();
    } catch (err) {
      this.logger.error(
        'فشل تسجيل webhook تلقائياً عند الإقلاع',
        (err as Error)?.stack,
      );
    }
  }

  /** يسجّل الـ webhook لدى Telegram */
  async registerWebhook(): Promise<{ ok: boolean; url: string }> {
    const url = `${this.publicApiUrl}/api/telegram/webhook`;
    const res = await this.callApi('setWebhook', {
      url,
      secret_token: this.webhookSecret || undefined,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: true,
    });
    if (res?.ok) {
      this.logger.log(`✅ تم تسجيل Telegram webhook: ${url}`);
    } else {
      this.logger.error(`فشل تسجيل webhook: ${JSON.stringify(res)}`);
    }
    return { ok: Boolean(res?.ok), url };
  }

  async getWebhookInfo() {
    return this.callApi('getWebhookInfo', {});
  }

  async deleteWebhook() {
    return this.callApi('deleteWebhook', { drop_pending_updates: false });
  }

  // ─── Telegram API helper ──────────────────────────────────────
  private async callApi(method: string, params: Record<string, any>) {
    if (!this.isEnabled) {
      this.logger.warn(`تخطّي ${method} — البوت معطّل`);
      return { ok: false, description: 'bot disabled' };
    }
    try {
      const res = await fetch(`${this.apiBase}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const data = await res.json();
      if (!data.ok) {
        this.logger.warn(`Telegram ${method} رفض: ${JSON.stringify(data)}`);
      }
      return data;
    } catch (err) {
      this.logger.error(
        `خطأ في استدعاء Telegram ${method}`,
        (err as Error)?.stack,
      );
      return { ok: false, description: (err as Error)?.message };
    }
  }

  async sendMessage(chatId: number | string, text: string) {
    return this.callApi('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  }

  // ─── Update handling ──────────────────────────────────────────
  async handleUpdate(update: any): Promise<void> {
    try {
      const message = update?.message ?? update?.edited_message;
      if (!message) return;

      const chatId = message.chat?.id;
      const text: string = (message.text ?? '').trim();
      if (!chatId || !text) return;

      // التحقق من الصلاحية
      if (
        this.allowedChatIds.size > 0 &&
        !this.allowedChatIds.has(String(chatId))
      ) {
        this.logger.warn(`دردشة غير مصرّح بها: ${chatId}`);
        await this.sendMessage(
          chatId,
          `⛔️ غير مصرّح لك باستخدام هذا البوت.\nمعرّف الدردشة: <code>${chatId}</code>\nأرسله للمسؤول لإضافتك.`,
        );
        return;
      }

      const command = text.split(/\s+/)[0].toLowerCase().replace(/@.*$/, '');

      switch (command) {
        case '/start':
          await this.cmdStart(chatId);
          break;
        case '/help':
          await this.cmdHelp(chatId);
          break;
        case '/production':
        case '/prod':
          await this.cmdProduction(chatId);
          break;
        case '/stock':
        case '/inventory':
          await this.cmdStock(chatId);
          break;
        case '/orders':
          await this.cmdOrders(chatId);
          break;
        case '/balance':
          await this.cmdBalance(chatId);
          break;
        default:
          await this.sendMessage(
            chatId,
            'أمر غير معروف. أرسل /help لعرض الأوامر المتاحة.',
          );
      }
    } catch (err) {
      this.logger.error('خطأ في معالجة التحديث', (err as Error)?.stack);
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────
  private async resolveTenantId(): Promise<string | null> {
    const configured = this.config.get<string>('TELEGRAM_DEFAULT_TENANT_ID');
    if (configured) return configured;
    const tenant = await this.prisma.tenant.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return tenant?.id ?? null;
  }

  private fmt(n: number): string {
    return n.toLocaleString('en-US');
  }

  // ─── Commands ─────────────────────────────────────────────────
  private async cmdStart(chatId: number) {
    await this.sendMessage(
      chatId,
      `🥛 <b>أهلاً بك في بوت Enjoy Milk ERP</b>\n` +
        `مصنع قصراوي إخوان\n\n` +
        `أرسل /help لعرض الأوامر المتاحة.`,
    );
  }

  private async cmdHelp(chatId: number) {
    await this.sendMessage(
      chatId,
      `<b>📋 الأوامر المتاحة:</b>\n\n` +
        `/production — تقرير إنتاج اليوم\n` +
        `/stock — الأصناف منخفضة المخزون\n` +
        `/orders — الطلبيات غير المدفوعة\n` +
        `/balance — رصيد المستودع\n` +
        `/help — هذه القائمة`,
    );
  }

  private async cmdProduction(chatId: number) {
    const tenantId = await this.resolveTenantId();
    if (!tenantId) return this.sendMessage(chatId, '⚠️ لا توجد بيانات.');

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86400000);

    const records = await this.prisma.dailyProduction.findMany({
      where: { tenantId, productionDate: { gte: start, lt: end } },
      include: { produced: true, wastages: true, milkUsage: true },
    });

    if (records.length === 0) {
      return this.sendMessage(
        chatId,
        '📊 <b>إنتاج اليوم</b>\n\nلا توجد سجلات إنتاج لهذا اليوم بعد.',
      );
    }

    let totalCartons = 0;
    let totalPallets = 0;
    let totalWaste = 0;
    let totalMilk = 0;
    for (const r of records) {
      for (const p of r.produced) {
        totalCartons += Number(p.cartonsTotal);
        totalPallets += Number(p.palletsCount ?? 0);
      }
      for (const w of r.wastages) totalWaste += Number(w.quantity);
      for (const m of r.milkUsage) totalMilk += Number(m.quantity);
    }

    await this.sendMessage(
      chatId,
      `📊 <b>تقرير إنتاج اليوم</b>\n` +
        `${start.toLocaleDateString('ar-EG')}\n\n` +
        `📋 عدد السجلات: <b>${records.length}</b>\n` +
        `✅ الكراتين المنتجة: <b>${this.fmt(totalCartons)}</b>\n` +
        `📦 الطبليات: <b>${this.fmt(totalPallets)}</b>\n` +
        `🥛 الحليب الخام: <b>${this.fmt(totalMilk)} لتر</b>\n` +
        `⚠️ التوالف: <b>${this.fmt(totalWaste)}</b>`,
    );
  }

  private async cmdStock(chatId: number) {
    const tenantId = await this.resolveTenantId();
    if (!tenantId) return this.sendMessage(chatId, '⚠️ لا توجد بيانات.');

    const items = await this.prisma.item.findMany({
      where: { tenantId, active: true, reorderLevel: { not: null } },
      include: { stockLevels: true },
    });

    const low = items
      .map((it) => {
        const total = it.stockLevels.reduce(
          (s, sl) => s + Number(sl.quantity),
          0,
        );
        return { name: it.name, sku: it.sku, total, reorder: Number(it.reorderLevel) };
      })
      .filter((it) => it.total < it.reorder);

    if (low.length === 0) {
      return this.sendMessage(
        chatId,
        '📦 <b>المخزون</b>\n\n✅ كل الأصناف فوق الحد الأدنى.',
      );
    }

    const lines = low
      .map(
        (it) =>
          `• <b>${it.name}</b> (${it.sku})\n   الرصيد: ${this.fmt(it.total)} / الحد: ${this.fmt(it.reorder)}`,
      )
      .join('\n');

    await this.sendMessage(
      chatId,
      `⚠️ <b>أصناف منخفضة المخزون (${low.length})</b>\n\n${lines}`,
    );
  }

  private async cmdOrders(chatId: number) {
    const tenantId = await this.resolveTenantId();
    if (!tenantId) return this.sendMessage(chatId, '⚠️ لا توجد بيانات.');

    const orders = await this.prisma.simpleOrder.findMany({
      where: {
        tenantId,
        status: { in: ['UNPAID', 'PARTIAL'] },
      },
      orderBy: { orderDate: 'desc' },
      take: 15,
    });

    if (orders.length === 0) {
      return this.sendMessage(
        chatId,
        '🛒 <b>الطلبيات</b>\n\n✅ كل الطلبيات مدفوعة بالكامل.',
      );
    }

    let totalBalance = 0;
    const lines = orders
      .map((o) => {
        const balance = Number(o.balance ?? 0);
        totalBalance += balance;
        const name = o.customerName ?? 'عميل';
        return `• <b>${name}</b>: متبقّي ${this.fmt(balance)} د.أ`;
      })
      .join('\n');

    await this.sendMessage(
      chatId,
      `💰 <b>الطلبيات غير المدفوعة (${orders.length})</b>\n\n${lines}\n\n` +
        `📌 إجمالي المتبقّي: <b>${this.fmt(totalBalance)} د.أ</b>`,
    );
  }

  private async cmdBalance(chatId: number) {
    const tenantId = await this.resolveTenantId();
    if (!tenantId) return this.sendMessage(chatId, '⚠️ لا توجد بيانات.');

    const items = await this.prisma.item.findMany({
      where: { tenantId, active: true },
      include: { stockLevels: true },
    });

    const milk: string[] = [];
    const carton: string[] = [];
    const aluminum: string[] = [];
    for (const it of items) {
      const total = it.stockLevels.reduce((s, sl) => s + Number(sl.quantity), 0);
      const row = `• ${it.name}: <b>${this.fmt(total)} ${it.unit}</b>`;
      if (it.sku.startsWith('RAW-MILK') || it.name.includes('حليب خام'))
        milk.push(row);
      else if (it.sku.startsWith('CTN') || it.name.includes('كرتون'))
        carton.push(row);
      else if (it.sku.startsWith('ALU') || it.name.includes('ألمنيوم'))
        aluminum.push(row);
    }

    const section = (title: string, rows: string[]) =>
      rows.length ? `\n<b>${title}</b>\n${rows.join('\n')}` : '';

    await this.sendMessage(
      chatId,
      `🏪 <b>رصيد المستودع</b>\n` +
        section('🥛 الحليب الخام', milk) +
        section('📦 الكرتون', carton) +
        section('🥫 الألمنيوم', aluminum),
    );
  }
}
