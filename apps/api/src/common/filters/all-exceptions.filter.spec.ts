import { BadRequestException, HttpStatus } from '@nestjs/common';
import { normaliseExceptionResponse } from './all-exceptions.filter';

/**
 * Regression cover for the production crash of 2026-09-01.
 *
 * `POST /api/inventory/items` with a duplicate SKU returned
 *   { statusCode: 400, message: { message: 'SKU مكرر', error: 'Bad Request' } }
 * i.e. data.message was an OBJECT. The web app renders that value directly,
 * so React threw "Objects are not valid as a React child" and the whole page
 * fell into the global error boundary ("حدث خطأ غير متوقع") for what was a
 * routine validation rejection.
 *
 * The contract these tests lock in: message is ALWAYS a string.
 */
describe('normaliseExceptionResponse', () => {
  const isString = (v: unknown) => expect(typeof v).toBe('string');

  it('flattens the exact production payload that crashed the page', () => {
    const raw = new BadRequestException('SKU مكرر').getResponse();
    const out = normaliseExceptionResponse(raw, 400);
    expect(out.message).toBe('SKU مكرر');
    isString(out.message);
  });

  it('passes a plain string response through unchanged', () => {
    const out = normaliseExceptionResponse('كمية غير صالحة', 400);
    expect(out.message).toBe('كمية غير صالحة');
  });

  it('joins a ValidationPipe string[] and preserves the list', () => {
    const out = normaliseExceptionResponse(
      { message: ['name should not be empty', 'unit must be a string'], error: 'Bad Request' },
      400,
    );
    isString(out.message);
    expect(out.message).toContain('name should not be empty');
    expect(out.errors).toHaveLength(2);
  });

  it('tolerates a doubly-nested message object', () => {
    const out = normaliseExceptionResponse({ message: { message: 'عميق' } }, 400);
    expect(out.message).toBe('عميق');
  });

  it('never returns a non-string for hostile shapes', () => {
    const shapes: unknown[] = [
      null, undefined, 42, [], {}, { message: null }, { message: {} },
      { message: [] }, { message: [{ a: 1 }] }, { error: 'Bad Request' },
      new Error('boom'),
    ];
    for (const raw of shapes) {
      const out = normaliseExceptionResponse(raw, 400);
      isString(out.message);
      expect(out.message.length).toBeGreaterThan(0);
    }
  });

  it('uses a server-side message for 5xx', () => {
    const out = normaliseExceptionResponse(undefined, HttpStatus.INTERNAL_SERVER_ERROR);
    isString(out.message);
  });
});
