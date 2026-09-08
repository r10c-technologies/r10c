import type { Locale } from '@r10c/entifix-ts-i18n/routing';

/**
 * A published price, rendered.
 *
 * ⚠️ `amount` is in **minor units** — an integer number of cents, never a
 * float, because a binary float cannot represent 0.10 exactly and money off by
 * a rounding error is money a settlement run reconciles by hand. So the
 * division by 100 belongs here, once, rather than at each render site where one
 * of them would eventually forget it and show a lamp for 19 990 quetzales.
 *
 * `Intl` decides the symbol, the separators and the fraction digits from the
 * pair, which is why the currency is never concatenated by hand: `Q 19.99` is
 * right in `es-GT` and wrong in `en-US`, and neither belongs in a template
 * literal.
 *
 * A currency the runtime does not recognise makes `Intl` throw. That is a
 * projection carrying a bad code rather than a rendering problem, so it falls
 * back to the plain amount and the code instead of taking the page down.
 */
export function formatMoney(
  locale: Locale,
  amount: number,
  currency: string,
): string {
  const major = amount / 100;

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
    }).format(major);
  } catch {
    return `${major.toFixed(2)} ${currency}`;
  }
}
