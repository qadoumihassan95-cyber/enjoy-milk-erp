import {
  normalizeDigits,
  sanitizeNumericInput,
  parseDecimal,
  toOptionalNumber,
} from './numeric';
import { extractApiMessage } from './api-errors';

/**
 * Regression cover for the mobile Add-Item failure.
 *
 * Two independent defects, both verified against production on 2026-09-01:
 *
 *  1. Every numeric field was <input type="number">. Typing Arabic-Indic
 *     digits set .value to "" silently (validity.valid === true), so the
 *     number the user entered never reached the payload.
 *  2. The API returned data.message as an OBJECT; the web app rendered it
 *     directly, React threw, and the global error boundary took the page.
 */
describe('digit normalisation', () => {
  it('converts Arabic-Indic digits', () => {
    expect(normalizeDigits('١٢')).toBe('12');
    expect(normalizeDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
  });

  it('converts Persian digits', () => {
    expect(normalizeDigits('۱۲')).toBe('12');
    expect(normalizeDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
  });

  it('converts the Arabic decimal separator', () => {
    expect(normalizeDigits('١٢٫٥')).toBe('12.5');
  });

  it('drops Arabic and Latin thousands separators', () => {
    expect(normalizeDigits('١٬٢٣٤')).toBe('1234');
    expect(normalizeDigits('1,234')).toBe('1234');
  });

  it('leaves Latin input untouched', () => {
    expect(normalizeDigits('10.5')).toBe('10.5');
  });
});

describe('parseDecimal', () => {
  it.each([
    ['١٢', 12],
    ['۱۲', 12],
    ['١٢.٥', 12.5],
    ['١٢٫٥', 12.5],
    ['12', 12],
    ['10.5', 10.5],
    ['0', 0],
    ['٠', 0],
    ['-5', -5],
  ])('parses %s → %s', (input, expected) => {
    expect(parseDecimal(input as string)).toBe(expected);
  });

  it('returns null (never NaN) for junk', () => {
    for (const bad of ['', '   ', 'abc', '-', '.', 'NaN', 'Infinity', '1e5x', null, undefined]) {
      const out = parseDecimal(bad as any);
      expect(out === null || Number.isFinite(out)).toBe(true);
      if (out !== null) expect(Number.isNaN(out)).toBe(false);
    }
    expect(parseDecimal('abc')).toBeNull();
    expect(parseDecimal('')).toBeNull();
  });

  it('never yields NaN or Infinity', () => {
    for (const bad of ['Infinity', '-Infinity', 'NaN', '1/0']) {
      expect(parseDecimal(bad)).toBeNull();
    }
    expect(parseDecimal(Number.POSITIVE_INFINITY)).toBeNull();
    expect(parseDecimal(Number.NaN)).toBeNull();
  });

  it('distinguishes zero from empty — zero is a real value', () => {
    expect(parseDecimal('0')).toBe(0);
    expect(toOptionalNumber('0')).toBe(0);
    expect(toOptionalNumber('')).toBeUndefined();
  });
});

describe('toOptionalNumber (what actually reaches the API)', () => {
  it('omits blank fields instead of sending null', () => {
    expect(JSON.stringify({ v: toOptionalNumber('') })).toBe('{}');
  });

  it('never lets NaN become null in the payload', () => {
    // The old code did `+form.costPrice`, and +'١٢' is NaN, which
    // JSON.stringify turns into null — silently corrupting the request.
    expect(JSON.stringify({ v: +'١٢' })).toBe('{"v":null}');
    expect(JSON.stringify({ v: toOptionalNumber('١٢') })).toBe('{"v":12}');
  });
});

describe('sanitizeNumericInput (while typing)', () => {
  it('keeps intermediate states usable', () => {
    expect(sanitizeNumericInput('')).toBe('');
    expect(sanitizeNumericInput('12.')).toBe('12.');
    expect(sanitizeNumericInput('.')).toBe('.');
  });

  it('normalises Arabic digits as they are typed', () => {
    expect(sanitizeNumericInput('١٢٫٥')).toBe('12.5');
  });

  it('strips letters and collapses extra dots', () => {
    expect(sanitizeNumericInput('12a.3.4')).toBe('12.34');
  });

  it('honours allowNegative and allowDecimal', () => {
    expect(sanitizeNumericInput('-5')).toBe('5');
    expect(sanitizeNumericInput('-5', { allowNegative: true })).toBe('-5');
    expect(sanitizeNumericInput('12.5', { allowDecimal: false })).toBe('125');
  });
});

describe('extractApiMessage — the crash guard', () => {
  const err = (data: any) => ({ response: { data } });

  it('flattens the exact payload that crashed production', () => {
    expect(
      extractApiMessage(
        err({ statusCode: 400, message: { message: 'SKU مكرر', error: 'Bad Request', statusCode: 400 } }),
      ),
    ).toBe('SKU مكرر');
  });

  it('handles a plain string message', () => {
    expect(extractApiMessage(err({ message: 'كمية غير صحيحة' }))).toBe('كمية غير صحيحة');
  });

  it('joins a validation array', () => {
    expect(extractApiMessage(err({ message: ['أ', 'ب'] }))).toBe('أ، ب');
  });

  it('ALWAYS returns a string — nothing renderable-unsafe escapes', () => {
    const shapes = [
      undefined, null, {}, { message: null }, { message: {} }, { message: [] },
      { message: [{ deep: 1 }] }, { message: { message: { message: 'x' } } },
      { error: 'Bad Request' }, { message: 42 }, { message: true },
    ];
    for (const d of shapes) {
      expect(typeof extractApiMessage(err(d))).toBe('string');
    }
    expect(typeof extractApiMessage(undefined)).toBe('string');
  });

  it('survives a circular structure without throwing', () => {
    const d: any = { message: {} };
    d.message.message = d.message;
    expect(typeof extractApiMessage(err(d))).toBe('string');
  });
});
