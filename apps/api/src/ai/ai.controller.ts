/**
 * AI Controller.
 *
 * Routes:
 *   GET  /api/ai/status           → provider config visibility (no secrets)
 *   POST /api/ai/chat             → non-streaming completion
 *   POST /api/ai/chat/stream      → SSE stream (falls back to a single JSON
 *                                     response body if streaming is off)
 *
 * Every request is authenticated via the app-global JwtAuthGuard —
 * we DO NOT bypass authentication. The AuthenticatedUser passed by the
 * guard is the source of user id / tenant id for logging + rate limits.
 */

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
// Avoid a hard dep on @types/express — Nest doesn't type-narrow these
// anywhere else in the codebase either. Any is enough for setHeader /
// write / end + req.on('close').
type ExpressReq = any;
type ExpressRes = any;
import { CurrentUser } from '../core/auth/current-user.decorator';
import type { AuthenticatedUser } from '../core/auth/jwt.strategy';
import { AiService } from './ai.service';
import { AiError } from './types/ai.types';
import type { ChatRequestDto, ChatResponseDto } from './dto/chat.dto';

function mapAiErrorToHttp(err: unknown): HttpException {
  if (err instanceof AiError) {
    const map: Record<string, HttpStatus> = {
      timeout: HttpStatus.GATEWAY_TIMEOUT,
      'rate-limit': HttpStatus.TOO_MANY_REQUESTS,
      unauthorized: HttpStatus.SERVICE_UNAVAILABLE, // don't leak "bad key" to end users
      'provider-unavailable': HttpStatus.SERVICE_UNAVAILABLE,
      'invalid-response': HttpStatus.BAD_GATEWAY,
      unknown: HttpStatus.INTERNAL_SERVER_ERROR,
    };
    const status = map[err.kind] ?? HttpStatus.INTERNAL_SERVER_ERROR;
    // Never expose internal provider messages verbatim to end users.
    const userMsg =
      err.kind === 'timeout' ? 'انتهت مهلة طلب الذكاء الاصطناعي، جرب مرة أخرى.' :
      err.kind === 'rate-limit' ? 'تم تجاوز الحد المسموح للذكاء الاصطناعي، انتظر قليلاً.' :
      err.kind === 'unauthorized' ? 'خدمة الذكاء الاصطناعي غير مُهيّأة على الخادم.' :
      err.kind === 'provider-unavailable' ? 'مزوّد الذكاء الاصطناعي غير متاح مؤقتاً.' :
      'خطأ في خدمة الذكاء الاصطناعي.';
    return new HttpException({ message: userMsg, kind: err.kind }, status);
  }
  return new HttpException(
    { message: 'خطأ داخلي في خدمة الذكاء الاصطناعي.' },
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}

function validate(body: ChatRequestDto): asserts body is ChatRequestDto {
  if (!body || typeof body.message !== 'string' || !body.message.trim()) {
    throw new BadRequestException('message is required.');
  }
  if (body.message.length > 8000) {
    throw new BadRequestException('message is too long (max 8000 chars).');
  }
  if (body.conversationId && typeof body.conversationId !== 'string') {
    throw new BadRequestException('conversationId must be a string.');
  }
  if (body.workspace && typeof body.workspace !== 'string') {
    throw new BadRequestException('workspace must be a string.');
  }
}

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(private readonly service: AiService) {}

  @Get('status')
  status(@CurrentUser() _user: AuthenticatedUser) {
    return this.service.getPublicStatus();
  }

  @Post('chat')
  async chat(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ChatRequestDto,
  ): Promise<ChatResponseDto> {
    validate(body);
    if (!user) throw new UnauthorizedException();
    const conversationId = body.conversationId?.trim() || AiService.newId();
    const requestId = AiService.newId();
    try {
      const res = await this.service.chat(
        body.message,
        {
          userId: user.id,
          tenantId: user.tenantId,
          conversationId,
          requestId,
          workspace: body.workspace,
          metadata: body.metadata as any,
        },
        body.tierHint,
      );
      return {
        conversationId: res.conversationId,
        requestId: res.requestId,
        content: res.content,
        usage: res.usage,
        costUsd: res.costUsd,
        provider: res.provider,
        model: res.model,
        latencyMs: res.latencyMs,
        tier: res.tier,
      };
    } catch (err) {
      throw mapAiErrorToHttp(err);
    }
  }

  @Post('chat/stream')
  async stream(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ChatRequestDto,
    @Req() req: ExpressReq,
    @Res() res: ExpressRes,
  ) {
    validate(body);
    if (!user) throw new UnauthorizedException();
    const conversationId = body.conversationId?.trim() || AiService.newId();
    const requestId = AiService.newId();

    // Server-Sent Events framing.
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    // Kick the connection with a comment so proxies flush headers.
    res.write(': ok\n\n');

    // If the client disconnects mid-stream, abort by breaking the loop.
    let closed = false;
    req.on('close', () => { closed = true; });

    const send = (event: string, data: unknown) => {
      if (closed) return;
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      for await (const chunk of this.service.chatStream(
        body.message,
        {
          userId: user.id,
          tenantId: user.tenantId,
          conversationId,
          requestId,
          workspace: body.workspace,
          metadata: body.metadata as any,
        },
        body.tierHint,
      )) {
        if (closed) break;
        if (chunk.delta) send('delta', { text: chunk.delta });
        if (chunk.done && chunk.final) {
          send('done', {
            conversationId,
            requestId,
            content: chunk.final.content,
            usage: chunk.final.usage,
            costUsd: chunk.final.costUsd,
            provider: chunk.final.provider,
            model: chunk.final.model,
            latencyMs: chunk.final.latencyMs,
            tier: chunk.tier,
          });
        }
      }
      if (!closed) res.end();
    } catch (err) {
      const httpErr = mapAiErrorToHttp(err) as any;
      send('error', {
        message: httpErr?.response?.message ?? 'AI stream failed.',
        kind: httpErr?.response?.kind ?? 'unknown',
        status: httpErr?.status ?? 500,
      });
      if (!closed) res.end();
    }
  }
}
