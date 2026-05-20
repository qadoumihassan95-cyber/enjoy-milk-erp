import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EmployeesService } from '../employees/employees.service';
import { FinanceService } from '../finance/finance.service';

interface Conversation {
  flow: 'expense' | 'employee' | 'editsalary' | 'note';
  step: string;
  data: Record<string, any>;
}

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
  // حالة المحادثات قيد التنفيذ (لإضافة مصروف خطوة بخطوة)
  private readonly conversations = new Map<string, Conversation>();

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly employees: EmployeesService,
    private readonly finance: FinanceService,
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

  async sendMessage(chatId: number | string, text: string, replyMarkup?: any) {
    return this.callApi('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  }

  /** لوحة الأزرار الرئيسية */
  private mainMenu() {
    return {
      inline_keyboard: [
        [
          { text: '📊 إنتاج اليوم', callback_data: '/production' },
          { text: '📦 المخزون', callback_data: '/stock' },
        ],
        [
          { text: '🛒 الطلبيات', callback_data: '/orders' },
          { text: '🏪 رصيد المستودع', callback_data: '/balance' },
        ],
        [
          { text: '👥 الحضور والدوام', callback_data: '/attendance' },
          { text: '💸 إضافة مصروف', callback_data: '/addexpense' },
        ],
        [
          { text: '🧑‍💼 إدارة الموظفين', callback_data: '/employees' },
          { text: '📈 التقرير المالي', callback_data: '/report' },
        ],
        [{ text: '🔄 تحديث القائمة', callback_data: '/menu' }],
      ],
    };
  }

  // ─── Update handling ──────────────────────────────────────────
  async handleUpdate(update: any): Promise<void> {
    try {
      // (1) ضغطة زر تفاعلي (Inline button)
      if (update?.callback_query) {
        const cq = update.callback_query;
        const chatId = cq.message?.chat?.id;
        const data: string = cq.data ?? '';
        // نُعلم Telegram أننا استلمنا الضغطة (يزيل دائرة التحميل)
        await this.callApi('answerCallbackQuery', { callback_query_id: cq.id });
        if (!chatId) return;
        if (this.isBlocked(chatId)) return this.rejectChat(chatId);

        // أزرار خاصة: اختيار موظف / تسجيل حضور / إدارة موظف
        if (data.startsWith('emp:')) return this.showEmployeeActions(chatId, data.slice(4));
        if (data.startsWith('att:')) {
          const [, empId, action] = data.split(':');
          return this.recordAttendance(chatId, empId, action);
        }
        if (data.startsWith('mgmt:')) return this.showEmployeeMgmt(chatId, data.slice(5));
        if (data.startsWith('empview:')) return this.viewEmployee(chatId, data.slice(8));
        if (data.startsWith('empsal:')) return this.startEditSalary(chatId, data.slice(7));
        if (data.startsWith('empnote:')) return this.startAddNote(chatId, data.slice(8));
        if (data.startsWith('empdelyes:')) return this.deleteEmployee(chatId, data.slice(10));
        if (data.startsWith('empdel:')) return this.confirmDeleteEmployee(chatId, data.slice(7));
        await this.routeCommand(chatId, data);
        return;
      }

      // (2) رسالة نصية
      const message = update?.message ?? update?.edited_message;
      if (!message) return;
      const chatId = message.chat?.id;
      const text: string = (message.text ?? '').trim();
      if (!chatId || !text) return;

      if (this.isBlocked(chatId)) return this.rejectChat(chatId);

      // إذا كان أمراً (يبدأ بـ /) — أوقف أي محادثة جارية ووجّهه
      if (text.startsWith('/')) {
        this.conversations.delete(String(chatId));
        const command = text.split(/\s+/)[0].toLowerCase().replace(/@.*$/, '');
        await this.routeCommand(chatId, command);
        return;
      }

      // إذا كانت هناك محادثة جارية (مثل إضافة مصروف) — مرّر النص لها
      if (this.conversations.has(String(chatId))) {
        await this.handleConversationInput(chatId, text);
        return;
      }

      // نص غير معروف — اعرض القائمة
      await this.sendMessage(chatId, 'اختر من القائمة:', this.mainMenu());
    } catch (err) {
      this.logger.error('خطأ في معالجة التحديث', (err as Error)?.stack);
    }
  }

  private isBlocked(chatId: number | string): boolean {
    return (
      this.allowedChatIds.size > 0 && !this.allowedChatIds.has(String(chatId))
    );
  }

  private async rejectChat(chatId: number | string) {
    this.logger.warn(`دردشة غير مصرّح بها: ${chatId}`);
    await this.sendMessage(
      chatId,
      `⛔️ غير مصرّح لك باستخدام هذا البوت.\nمعرّف الدردشة: <code>${chatId}</code>\nأرسله للمسؤول لإضافتك.`,
    );
  }

  /** توجيه الأمر (يأتي من رسالة أو من ضغطة زر) */
  private async routeCommand(chatId: number, command: string) {
    switch (command) {
      case '/start':
        return this.cmdStart(chatId);
      case '/help':
      case '/menu':
        return this.cmdHelp(chatId);
      case '/production':
      case '/prod':
        return this.cmdProduction(chatId);
      case '/stock':
      case '/inventory':
        return this.cmdStock(chatId);
      case '/orders':
        return this.cmdOrders(chatId);
      case '/balance':
        return this.cmdBalance(chatId);
      case '/attendance':
      case '/hr':
        return this.cmdAttendance(chatId);
      case '/addexpense':
      case '/expense':
        return this.startExpenseFlow(chatId);
      case '/employees':
        return this.cmdEmployees(chatId);
      case '/addemployee':
        return this.startAddEmployee(chatId);
      case '/report':
        return this.cmdReport(chatId);
      default:
        return this.sendMessage(
          chatId,
          'أمر غير معروف. اختر من القائمة:',
          this.mainMenu(),
        );
    }
  }

  // ─── إدارة: الحضور والدوام من البوت ───────────────────────────
  /** يعرض الموظفين كأزرار لاختيار من نُسجّل حضوره */
  private async cmdAttendance(chatId: number) {
    const tenantId = await this.resolveTenantId();
    if (!tenantId) return this.sendMessage(chatId, '⚠️ لا توجد بيانات.');

    const emps = await this.prisma.employee.findMany({
      where: { tenantId, active: true },
      orderBy: { fullName: 'asc' },
      take: 50,
      select: { id: true, fullName: true },
    });
    if (emps.length === 0)
      return this.sendMessage(chatId, 'لا يوجد موظفون مسجّلون.');

    const rows = emps.map((e) => [
      { text: e.fullName, callback_data: `emp:${e.id}` },
    ]);
    await this.sendMessage(chatId, '👥 <b>اختر الموظف لتسجيل دوامه:</b>', {
      inline_keyboard: rows,
    });
  }

  /** أزرار العمليات لموظف محدد */
  private async showEmployeeActions(chatId: number, empId: string) {
    const emp = await this.prisma.employee.findUnique({
      where: { id: empId },
      select: { fullName: true },
    });
    if (!emp) return this.sendMessage(chatId, 'الموظف غير موجود.');

    await this.sendMessage(chatId, `👤 <b>${emp.fullName}</b>\nاختر العملية:`, {
      inline_keyboard: [
        [
          { text: '✅ حضور', callback_data: `att:${empId}:PRESENT` },
          { text: '⛔️ غياب', callback_data: `att:${empId}:ABSENT` },
        ],
        [
          { text: '⏰ تأخير', callback_data: `att:${empId}:LATE` },
          { text: '➕ عمل إضافي (ساعة)', callback_data: `att:${empId}:OT` },
        ],
        [{ text: '« رجوع', callback_data: '/attendance' }],
      ],
    });
  }

  /** تسجيل الحضور فعلياً عبر EmployeesService (مرتبط بالرواتب) */
  private async recordAttendance(chatId: number, empId: string, action: string) {
    const tenantId = await this.resolveTenantId();
    if (!tenantId) return this.sendMessage(chatId, '⚠️ لا توجد بيانات.');
    try {
      if (action === 'OT') {
        await this.employees.markAttendance(tenantId, empId, { overtimeMin: 60 });
        await this.sendMessage(chatId, '✅ سُجّلت ساعة عمل إضافي.', this.mainMenu());
      } else {
        await this.employees.markAttendance(tenantId, empId, { status: action });
        const label =
          action === 'PRESENT' ? 'حضور' : action === 'ABSENT' ? 'غياب' : 'تأخير';
        await this.sendMessage(chatId, `✅ سُجّل: ${label}.`, this.mainMenu());
      }
    } catch (err) {
      this.logger.error('فشل تسجيل الحضور', (err as Error)?.stack);
      await this.sendMessage(chatId, '⚠️ تعذّر التسجيل، حاول لاحقاً.');
    }
  }

  // ─── إدارة الموظفين الكاملة من البوت ──────────────────────────
  private async cmdEmployees(chatId: number) {
    const tenantId = await this.resolveTenantId();
    if (!tenantId) return this.sendMessage(chatId, '⚠️ لا توجد بيانات.');
    const emps = await this.prisma.employee.findMany({
      where: { tenantId, active: true },
      orderBy: { fullName: 'asc' },
      take: 50,
      select: { id: true, fullName: true },
    });
    const rows = emps.map((e) => [
      { text: e.fullName, callback_data: `mgmt:${e.id}` },
    ]);
    rows.push([{ text: '➕ إضافة موظف جديد', callback_data: '/addemployee' }]);
    await this.sendMessage(chatId, '🧑‍💼 <b>إدارة الموظفين</b>\nاختر موظفاً أو أضف جديداً:', {
      inline_keyboard: rows,
    });
  }

  private async showEmployeeMgmt(chatId: number, empId: string) {
    const emp = await this.prisma.employee.findUnique({
      where: { id: empId },
      select: { fullName: true },
    });
    if (!emp) return this.sendMessage(chatId, 'الموظف غير موجود.');
    await this.sendMessage(chatId, `👤 <b>${emp.fullName}</b>\nاختر العملية:`, {
      inline_keyboard: [
        [
          { text: '👁 عرض البيانات', callback_data: `empview:${empId}` },
          { text: '💰 تعديل الراتب', callback_data: `empsal:${empId}` },
        ],
        [
          { text: '📝 إضافة ملاحظة', callback_data: `empnote:${empId}` },
          { text: '🗑 حذف', callback_data: `empdel:${empId}` },
        ],
        [{ text: '« رجوع', callback_data: '/employees' }],
      ],
    });
  }

  private async viewEmployee(chatId: number, empId: string) {
    const tenantId = await this.resolveTenantId();
    if (!tenantId) return this.sendMessage(chatId, '⚠️ لا توجد بيانات.');
    const e = await this.prisma.employee.findFirst({ where: { id: empId, tenantId } });
    if (!e) return this.sendMessage(chatId, 'الموظف غير موجود.');
    await this.sendMessage(
      chatId,
      `👤 <b>${e.fullName}</b>\n` +
        `الكود: <code>${e.code}</code>\n` +
        `القسم: ${e.department || '—'}\n` +
        `المنصب: ${e.position || '—'}\n` +
        `الهاتف: ${e.phone || '—'}\n` +
        `الراتب: <b>${this.fmt(Number(e.baseSalary ?? 0))} د.أ</b>\n` +
        `ملاحظات: ${e.notes || '—'}`,
      { inline_keyboard: [[{ text: '« رجوع', callback_data: `mgmt:${empId}` }]] },
    );
  }

  private async startEditSalary(chatId: number, empId: string) {
    this.conversations.set(String(chatId), {
      flow: 'editsalary',
      step: 'amount',
      data: { empId },
    });
    await this.sendMessage(chatId, '💰 أرسل <b>الراتب الجديد</b> (بالدينار). أو /menu للإلغاء.');
  }

  private async startAddNote(chatId: number, empId: string) {
    this.conversations.set(String(chatId), {
      flow: 'note',
      step: 'text',
      data: { empId },
    });
    await this.sendMessage(chatId, '📝 اكتب <b>الملاحظة</b>. أو /menu للإلغاء.');
  }

  private async confirmDeleteEmployee(chatId: number, empId: string) {
    const e = await this.prisma.employee.findUnique({
      where: { id: empId },
      select: { fullName: true },
    });
    if (!e) return this.sendMessage(chatId, 'الموظف غير موجود.');
    await this.sendMessage(chatId, `⚠️ تأكيد حذف <b>${e.fullName}</b>؟`, {
      inline_keyboard: [
        [
          { text: '🗑 نعم، احذف', callback_data: `empdelyes:${empId}` },
          { text: '« إلغاء', callback_data: `mgmt:${empId}` },
        ],
      ],
    });
  }

  private async deleteEmployee(chatId: number, empId: string) {
    const tenantId = await this.resolveTenantId();
    if (!tenantId) return this.sendMessage(chatId, '⚠️ لا توجد بيانات.');
    try {
      await this.employees.delete(tenantId, empId);
      await this.sendMessage(chatId, '✅ تم حذف الموظف.', this.mainMenu());
    } catch {
      await this.sendMessage(chatId, '⚠️ تعذّر الحذف.');
    }
  }

  private async startAddEmployee(chatId: number) {
    this.conversations.set(String(chatId), {
      flow: 'employee',
      step: 'name',
      data: {},
    });
    await this.sendMessage(
      chatId,
      '➕ <b>إضافة موظف جديد</b>\n\nأرسل <b>الاسم الكامل</b>. أو /menu للإلغاء.',
    );
  }

  // ─── التقرير المالي من البوت ──────────────────────────────────
  private async cmdReport(chatId: number) {
    const tenantId = await this.resolveTenantId();
    if (!tenantId) return this.sendMessage(chatId, '⚠️ لا توجد بيانات.');
    const r = await this.finance.getFinancialReport(tenantId);
    const cats = Object.entries(r.byCategory)
      .sort((a: any, b: any) => b[1] - a[1])
      .slice(0, 5)
      .map(([c, a]: any) => `  • ${c}: ${this.fmt(a)}`)
      .join('\n');
    await this.sendMessage(
      chatId,
      `📈 <b>التقرير المالي (الشهر الحالي)</b>\n` +
        `${r.from} → ${r.to}\n\n` +
        `💰 المبيعات: <b>${this.fmt(r.totalSales)} د.أ</b>\n` +
        `✅ المحصّل: ${this.fmt(r.collected)}\n` +
        `⏳ مستحق (ديون): ${this.fmt(r.outstanding)}\n` +
        `💸 المصاريف: ${this.fmt(r.totalExpenses)}\n` +
        `${r.profit >= 0 ? '📈' : '📉'} <b>صافي الربح: ${this.fmt(r.profit)} د.أ</b> (${r.margin}%)\n` +
        (cats ? `\n<b>أعلى المصاريف:</b>\n${cats}` : ''),
      this.mainMenu(),
    );
  }

  // ─── إدارة: إضافة مصروف (محادثة خطوة بخطوة) ──────────────────
  private async startExpenseFlow(chatId: number) {
    this.conversations.set(String(chatId), {
      flow: 'expense',
      step: 'amount',
      data: {},
    });
    await this.sendMessage(
      chatId,
      '💸 <b>إضافة مصروف</b>\n\nأرسل <b>المبلغ</b> (بالدينار). أو أرسل /menu للإلغاء.',
    );
  }

  private async handleConversationInput(chatId: number, text: string) {
    const key = String(chatId);
    const conv = this.conversations.get(key);
    if (!conv) return;

    if (conv.flow === 'expense') {
      if (conv.step === 'amount') {
        const amount = parseFloat(text.replace(/[^\d.]/g, ''));
        if (isNaN(amount) || amount <= 0) {
          return this.sendMessage(chatId, '⚠️ مبلغ غير صحيح. أرسل رقماً موجباً.');
        }
        conv.data.amount = amount;
        conv.step = 'category';
        this.conversations.set(key, conv);
        return this.sendMessage(
          chatId,
          'اكتب <b>تصنيف/وصف</b> المصروف (مثل: كهرباء، وقود، رواتب).',
        );
      }
      if (conv.step === 'category') {
        conv.data.category = text.trim();
        this.conversations.delete(key);
        const tenantId = await this.resolveTenantId();
        if (!tenantId) return this.sendMessage(chatId, '⚠️ لا توجد بيانات.');
        try {
          const actorId = await this.resolveActorUserId(tenantId);
          await this.finance.createExpense(tenantId, actorId, {
            category: conv.data.category,
            amount: conv.data.amount,
            description: conv.data.category,
          });
          return this.sendMessage(
            chatId,
            `✅ <b>تمت إضافة المصروف</b>\nالمبلغ: ${this.fmt(conv.data.amount)} د.أ\nالتصنيف: ${conv.data.category}`,
            this.mainMenu(),
          );
        } catch (err) {
          this.logger.error('فشل إضافة المصروف', (err as Error)?.stack);
          return this.sendMessage(chatId, '⚠️ تعذّرت إضافة المصروف.');
        }
      }
      return;
    }

    // ── تعديل راتب موظف ──
    if (conv.flow === 'editsalary' && conv.step === 'amount') {
      const salary = parseFloat(text.replace(/[^\d.]/g, ''));
      if (isNaN(salary) || salary < 0) {
        return this.sendMessage(chatId, '⚠️ راتب غير صحيح. أرسل رقماً.');
      }
      this.conversations.delete(key);
      const tenantId = await this.resolveTenantId();
      if (!tenantId) return this.sendMessage(chatId, '⚠️ لا توجد بيانات.');
      try {
        await this.employees.update(tenantId, conv.data.empId, { baseSalary: salary });
        return this.sendMessage(
          chatId,
          `✅ تم تحديث الراتب إلى <b>${this.fmt(salary)} د.أ</b>`,
          this.mainMenu(),
        );
      } catch {
        return this.sendMessage(chatId, '⚠️ تعذّر تحديث الراتب.');
      }
    }

    // ── إضافة ملاحظة لموظف ──
    if (conv.flow === 'note' && conv.step === 'text') {
      this.conversations.delete(key);
      const tenantId = await this.resolveTenantId();
      if (!tenantId) return this.sendMessage(chatId, '⚠️ لا توجد بيانات.');
      try {
        await this.employees.update(tenantId, conv.data.empId, { notes: text.trim() });
        return this.sendMessage(chatId, '✅ تم حفظ الملاحظة.', this.mainMenu());
      } catch {
        return this.sendMessage(chatId, '⚠️ تعذّر حفظ الملاحظة.');
      }
    }

    // ── إضافة موظف جديد (خطوات) ──
    if (conv.flow === 'employee') {
      if (conv.step === 'name') {
        conv.data.fullName = text.trim();
        conv.step = 'phone';
        this.conversations.set(key, conv);
        return this.sendMessage(chatId, 'أرسل <b>رقم الهاتف</b> (أو اكتب - للتخطي).');
      }
      if (conv.step === 'phone') {
        conv.data.phone = text.trim() === '-' ? undefined : text.trim();
        conv.step = 'department';
        this.conversations.set(key, conv);
        return this.sendMessage(chatId, 'أرسل <b>القسم</b> (أو - للتخطي).');
      }
      if (conv.step === 'department') {
        conv.data.department = text.trim() === '-' ? undefined : text.trim();
        conv.step = 'salary';
        this.conversations.set(key, conv);
        return this.sendMessage(chatId, 'أرسل <b>الراتب الأساسي</b> (بالدينار).');
      }
      if (conv.step === 'salary') {
        const salary = parseFloat(text.replace(/[^\d.]/g, ''));
        this.conversations.delete(key);
        const tenantId = await this.resolveTenantId();
        if (!tenantId) return this.sendMessage(chatId, '⚠️ لا توجد بيانات.');
        try {
          await this.employees.create(tenantId, {
            fullName: conv.data.fullName,
            phone: conv.data.phone,
            department: conv.data.department,
            baseSalary: isNaN(salary) ? undefined : salary,
          });
          return this.sendMessage(
            chatId,
            `✅ <b>تمت إضافة الموظف</b>\nالاسم: ${conv.data.fullName}\nالراتب: ${isNaN(salary) ? '—' : this.fmt(salary) + ' د.أ'}`,
            this.mainMenu(),
          );
        } catch {
          return this.sendMessage(chatId, '⚠️ تعذّرت إضافة الموظف.');
        }
      }
    }
  }

  private async resolveActorUserId(tenantId: string): Promise<string> {
    const u = await this.prisma.user.findFirst({
      where: { tenantId, active: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return u?.id ?? '';
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
        `اختر من القائمة بالأسفل 👇`,
      this.mainMenu(),
    );
  }

  private async cmdHelp(chatId: number) {
    await this.sendMessage(
      chatId,
      `<b>📋 القائمة الرئيسية</b>\n\n` +
        `اضغط أي زر، أو استخدم الأوامر:\n` +
        `/production · /stock · /orders · /balance`,
      this.mainMenu(),
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
