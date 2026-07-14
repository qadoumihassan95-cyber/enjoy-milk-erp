/**
 * Currency utilities (Enjoy Milk ERP) — مصدر واحد لتنسيق العملات في النظام كله.
 *
 * الدعم:
 *   - JOD (الدينار الأردني) → 3 خانات عشرية · د.أ
 *   - USD (الدولار الأمريكي) → 2 خانات عشرية · $
 *
 * لا نجمع مبالغ بعملات مختلفة مباشرة. نستخدم exchangeRate المحفوظ
 * على المعاملة لتحويلها إلى العملة الأساسية للتقارير.
 */

export type CurrencyCode = 'JOD' | 'USD';

export interface CurrencyMeta {
  code: CurrencyCode;
  arSymbol: string;
  enSymbol: string;
  arName: string;
  enName: string;
  decimals: number;
}

export const CURRENCIES: Record<CurrencyCode, CurrencyMeta> = {
  JOD: { code: 'JOD', arSymbol: 'د.أ', enSymbol: 'JOD', arName: 'الدينار الأردني', enName: 'Jordanian Dinar', decimals: 3 },
  USD: { code: 'USD', arSymbol: '$',   enSymbol: 'USD', arName: 'الدولار الأمريكي', enName: 'US Dollar', decimals: 2 },
};

export const DEFAULT_CURRENCY: CurrencyCode = 'JOD';

/**
 * تنسيق مبلغ حسب العملة المطلوبة.
 * @param amount   القيمة الرقمية.
 * @param currency رمز العملة (افتراضي JOD).
 * @param opts     { locale: 'ar' | 'en' | 'both'; symbolPosition: 'prefix' | 'suffix' | 'auto' }
 */
export function formatCurrency(
  amount: number | string | null | undefined,
  currency: CurrencyCode = DEFAULT_CURRENCY,
  opts: { locale?: 'ar' | 'en'; symbolPosition?: 'prefix' | 'suffix' | 'auto' } = {},
): string {
  const meta = CURRENCIES[currency] ?? CURRENCIES[DEFAULT_CURRENCY];
  const n = Number(amount || 0);
  const number = n.toLocaleString('en-US', {
    minimumFractionDigits: meta.decimals,
    maximumFractionDigits: meta.decimals,
  });
  const locale = opts.locale ?? 'ar';
  const symbol = locale === 'ar' ? meta.arSymbol : meta.enSymbol;
  // موضع الرمز الافتراضي: USD prefix ($1,000.00) و JOD suffix (1,000.000 د.أ).
  const pos = opts.symbolPosition ?? (currency === 'USD' ? 'prefix' : 'suffix');
  return pos === 'prefix' ? `${symbol}${number}` : `${number} ${symbol}`;
}

/** يعيد قيمة رقمية بعد التقريب لعدد خانات العملة الصحيح. */
export function roundToCurrency(amount: number, currency: CurrencyCode = DEFAULT_CURRENCY): number {
  const meta = CURRENCIES[currency] ?? CURRENCIES[DEFAULT_CURRENCY];
  const p = Math.pow(10, meta.decimals);
  return Math.round(amount * p) / p;
}

/**
 * تحويل مبلغ من عملة أصلية إلى عملة قاعدية باستخدام سعر صرف محفوظ.
 * amountInBase = amount × exchangeRate  (حيث exchangeRate = base per source)
 * مثال: 1000 USD × 0.709 = 709 JOD (عندما base = JOD).
 * إذا العملتان نفسهما، السعر يُعامَل كـ 1.
 */
export function convertToBase(
  amount: number,
  transactionCurrency: CurrencyCode,
  baseCurrency: CurrencyCode,
  exchangeRate: number,
): number {
  if (transactionCurrency === baseCurrency) return roundToCurrency(amount, baseCurrency);
  const rate = Number(exchangeRate) || 1;
  return roundToCurrency(amount * rate, baseCurrency);
}

/** يعيد رمز العملة (Arabic) — دالة مختصرة للاستخدام في الجداول. */
export function currencySymbol(currency: CurrencyCode = DEFAULT_CURRENCY, locale: 'ar' | 'en' = 'ar'): string {
  const meta = CURRENCIES[currency] ?? CURRENCIES[DEFAULT_CURRENCY];
  return locale === 'ar' ? meta.arSymbol : meta.enSymbol;
}

/** يعيد كل خيارات العملات المدعومة (للـ dropdowns). */
export function currencyOptions(): { value: CurrencyCode; label: string }[] {
  return (Object.keys(CURRENCIES) as CurrencyCode[]).map((code) => {
    const m = CURRENCIES[code];
    return { value: code, label: `${m.arName} (${code})` };
  });
}
