/**
 * Numeric input helpers for an Arabic-first ERP.
 *
 * WHY
 * ---
 * Every numeric field in the app was `<input type="number">`. Per the HTML
 * spec such an input only accepts Latin digits: when a user on an Arabic
 * phone keyboard types "١٢", the browser sets `.value` to "" — silently,
 * with `validity.valid === true` and `validity.badInput === false`. Nothing
 * warns anyone. The value simply vanishes, and `+''` → 0 / `+'١٢'` → NaN,
 * which `JSON.stringify` then sends to the API as `null`.
 *
 * Verified against production on 2026-09-01 (375px, Android UA):
 *     typed "١١" → readBack "" , valid true , badInput false
 *
 * The fix is to accept text, normalise the digits ourselves, and only then
 * parse. Fields keep `inputMode="decimal"` so phones still show a numeric
 * keypad, and direct typing always works on every platform.
 */

/** Arabic-Indic ٠-٩ (U+0660-0669) and Persian/Urdu ۰-۹ (U+06F0-06F9). */
const ARABIC_INDIC_ZERO = 0x0660;
const PERSIAN_ZERO = 0x06f0;

/**
 * Convert Arabic-Indic and Persian digits to Latin, and the Arabic decimal
 * separator (U+066B ٫) and Arabic thousands separator (U+066C ٬) to "." and
 * "" respectively. Also tolerates the Arabic comma and normal comma used as
 * a thousands separator.
 */
export function normalizeDigits(input: string): string {
  if (!input) return '';
  let out = '';
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
      out += String(code - ARABIC_INDIC_ZERO);
    } else if (code >= PERSIAN_ZERO && code <= PERSIAN_ZERO + 9) {
      out += String(code - PERSIAN_ZERO);
    } else if (ch === '٫') {
      out += '.'; // Arabic decimal separator
    } else if (ch === '٬' || ch === '،' || ch === ',') {
      // thousands separators — drop
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * What a numeric field is allowed to contain WHILE TYPING. Deliberately
 * permissive: an empty string, a lone "-", and a trailing "." are all valid
 * intermediate states. Rejecting them would fight the user mid-keystroke.
 */
export function sanitizeNumericInput(
  raw: string,
  opts: { allowNegative?: boolean; allowDecimal?: boolean } = {},
): string {
  const { allowNegative = false, allowDecimal = true } = opts;
  let s = normalizeDigits(raw).trim();
  // Keep a single leading minus when permitted.
  let neg = false;
  if (s.startsWith('-')) {
    neg = allowNegative;
    s = s.slice(1);
  }
  // Strip everything that is not a digit or a dot.
  s = s.replace(allowDecimal ? /[^0-9.]/g : /[^0-9]/g, '');
  if (allowDecimal) {
    // Collapse multiple dots to the first one.
    const i = s.indexOf('.');
    if (i !== -1) {
      s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '');
    }
  }
  return (neg ? '-' : '') + s;
}

/**
 * Parse a user-entered numeric string into a finite number, or null.
 *
 * Returns null — never NaN, never Infinity, never undefined-by-accident —
 * so callers can make one explicit decision about what an absent value
 * means instead of leaking NaN into a JSON body as `null`.
 */
export function parseDecimal(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const s = normalizeDigits(String(raw)).trim();
  if (!s || s === '-' || s === '.' || s === '-.') return null;
  if (!/^-?\d*\.?\d*$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse for submission: returns a finite number, or undefined when the field
 * was left blank. `undefined` is dropped by JSON.stringify, so an empty
 * optional field simply is not sent — which is what the API expects.
 */
export function toOptionalNumber(raw: string | number | null | undefined): number | undefined {
  const n = parseDecimal(raw);
  return n === null ? undefined : n;
}

/**
 * Blur on wheel. `type="number"` inputs change their value when the wheel
 * scrolls over a focused field, which silently edits data the user never
 * meant to touch. Attach to onWheel.
 */
export function blurOnWheel(e: { currentTarget: { blur: () => void } }) {
  e.currentTarget.blur();
}

/** Props every manual-entry numeric field should carry. */
export const NUMERIC_INPUT_PROPS = {
  type: 'text' as const,
  inputMode: 'decimal' as const,
  autoComplete: 'off' as const,
  dir: 'ltr' as const,
};
