import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Logger,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../core/auth/jwt-auth.guard';
import { TelegramService } from './telegram.service';
import { TelegramAccountsService } from './telegram-accounts.service';

@ApiExcludeController()
@Controller('telegram')
export class TelegramController {
  private readonly logger = new Logger(TelegramController.name);

  constructor(
    private readonly telegram: TelegramService,
    private readonly accounts: TelegramAccountsService,
  ) {}

  /**
   * نقطة استقبال تحديثات Telegram (Webhook).
   * عامّة (Public) لأن Telegram يستدعيها بدون توكن JWT،
   * لكنها محميّة بسرّ الـ webhook في الرأس X-Telegram-Bot-Api-Secret-Token.
   */
  @Public()
  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Body() update: any,
    @Headers('x-telegram-bot-api-secret-token') secret?: string,
  ) {
    if (!this.telegram.verifySecret(secret)) {
      this.logger.warn('رُفض webhook: سر غير صحيح');
      throw new UnauthorizedException('invalid secret');
    }
    // نعالج بدون انتظار حتى نرجّع 200 بسرعة لـ Telegram
    this.telegram.handleUpdate(update).catch((err) =>
      this.logger.error('فشل معالجة التحديث', err?.stack),
    );
    return { ok: true };
  }

  /**
   * Webhook خاص بكل حساب Telegram مُدار (متعدد الحسابات).
   * المسار: /api/telegram/webhook/account/:id
   * محمي بسرّ الـ webhook الخاص بالحساب.
   */
  @Public()
  @Post('webhook/account/:id')
  @HttpCode(200)
  async accountWebhook(
    @Param('id') id: string,
    @Body() update: any,
    @Headers('x-telegram-bot-api-secret-token') secret?: string,
  ) {
    const account = await this.accounts.findForWebhook(id);
    // تجاهل بهدوء إن لم يوجد/مُعطَّل/محذوف (نرجّع 200 حتى لا يعيد Telegram المحاولة)
    if (!account || !account.active || account.status === 'DISABLED') {
      return { ok: true };
    }
    if (account.webhookSecret && secret !== account.webhookSecret) {
      this.logger.warn(`رُفض webhook الحساب ${id}: سر غير صحيح`);
      throw new UnauthorizedException('invalid secret');
    }
    this.telegram
      .handleUpdateForAccount(
        {
          id: account.id,
          token: account.token,
          webhookSecret: account.webhookSecret,
          tenantId: account.tenantId,
          role: account.role as any,
        },
        update,
      )
      .catch((err) => this.logger.error('فشل معالجة تحديث الحساب', err?.stack));
    return { ok: true };
  }

  /**
   * تسجيل الـ webhook يدوياً (محمي بـ JWT — للمسؤول فقط).
   * استخدمه إذا لم يُسجَّل تلقائياً عند الإقلاع.
   */
  @Get('setup')
  async setup() {
    return this.telegram.registerWebhook();
  }

  /** معلومات الـ webhook الحالي (محمي بـ JWT) */
  @Get('info')
  async info() {
    return this.telegram.getWebhookInfo();
  }

  /** حذف الـ webhook (محمي بـ JWT) */
  @Get('delete')
  async remove() {
    return this.telegram.deleteWebhook();
  }
}
