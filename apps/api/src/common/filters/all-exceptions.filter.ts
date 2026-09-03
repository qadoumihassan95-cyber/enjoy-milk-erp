import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

/**
 * Normalised error envelope.
 *
 * WHY THIS SHAPE MATTERS
 * ----------------------
 * Nest's `HttpException.getResponse()` returns EITHER a plain string
 * (`new BadRequestException('SKU مكرر')` → the string) OR an object
 * (`{ message, error, statusCode }`), and for a failed ValidationPipe it
 * returns `{ message: string[], ... }`.
 *
 * The previous filter assigned that raw value straight to `message`, so a
 * 400 went out as:
 *
 *     { statusCode: 400, message: { message: 'SKU مكرر', error: '…' } }
 *
 * i.e. `data.message` was an OBJECT. Every caller in the web app does
 * `err?.response?.data?.message || 'fallback'` and renders the result, so
 * the object reached React as a child and threw
 * "Objects are not valid as a React child" — which escaped the component
 * and tripped the global error boundary ("حدث خطأ غير متوقع") for what was
 * really a routine, recoverable validation error.
 *
 * `message` is now ALWAYS a string. Validation details are preserved
 * separately in `errors` so nothing is lost.
 */
export interface ErrorEnvelope {
  statusCode: number;
  timestamp: string;
  path: string;
  /** Always a string — safe to render directly. */
  message: string;
  /** Present only for validation failures that produced a list. */
  errors?: string[];
  /** Short label, e.g. "Bad Request". */
  error?: string;
  /**
   * Any additional keys the thrown exception carried (e.g. a machine-readable
   * `code` and a `conflict` descriptor). `message` stays a plain string for
   * rendering; callers that want to branch read `details`.
   */
  details?: Record<string, unknown>;
}

/** Keys the envelope owns; everything else on the payload becomes `details`. */
const RESERVED = new Set(['message', 'error', 'statusCode']);

const FALLBACK = 'حدث خطأ في الخادم';

/** Flatten whatever getResponse() produced into { message, errors, error }. */
export function normaliseExceptionResponse(
  raw: unknown,
  status: number,
): { message: string; errors?: string[]; error?: string; details?: Record<string, unknown> } {
  // Plain string response — already correct.
  if (typeof raw === 'string' && raw.trim()) {
    return { message: raw };
  }

  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const inner = obj.message;
    const error = typeof obj.error === 'string' ? obj.error : undefined;
    const extra = Object.keys(obj).filter((k) => !RESERVED.has(k));
    const details = extra.length
      ? Object.fromEntries(extra.map((k) => [k, obj[k]]))
      : undefined;

    // ValidationPipe: message is a string[].
    if (Array.isArray(inner)) {
      const list = inner.map((m) => String(m)).filter(Boolean);
      return {
        message: list.length ? list.join('، ') : FALLBACK,
        errors: list.length ? list : undefined,
        error,
        details,
      };
    }

    if (typeof inner === 'string' && inner.trim()) {
      return { message: inner, error, details };
    }

    // Nested one more level ({ message: { message: '…' } }) — be tolerant.
    if (inner && typeof inner === 'object') {
      const deep = (inner as Record<string, unknown>).message;
      if (typeof deep === 'string' && deep.trim()) {
        return { message: deep, error, details };
      }
      if (Array.isArray(deep)) {
        const list = deep.map((m) => String(m)).filter(Boolean);
        if (list.length) {
          return { message: list.join('، '), errors: list, error, details };
        }
      }
    }

    if (error) return { message: error, error, details };
  }

  return {
    message: status >= 500 ? FALLBACK : 'طلب غير صالح',
  };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const raw =
      exception instanceof HttpException
        ? exception.getResponse()
        : FALLBACK;

    const { message, errors, error, details } = normaliseExceptionResponse(raw, status);

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url}`,
        (exception as Error)?.stack,
      );
    }

    const body: ErrorEnvelope = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
    };
    if (errors) body.errors = errors;
    if (error) body.error = error;
    if (details) body.details = details;

    response.status(status).json(body);
  }
}
