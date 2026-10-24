/**
 * A price, rendered.
 *
 * ⚠️ `amount` is in **minor units**: an integer number of cents, never a float,
 * because a binary float cannot represent 0.10 exactly. So the division by 100
 * happens here, once, rather than at each render site, where one of them would
 * eventually forget it and show a lamp for 19 990 quetzales.
 *
 * `Intl` picks the symbol, the separators and the fraction digits from the
 * locale and currency, which is why a currency is never concatenated by hand:
 * `Q 19.99` is right in `es-GT` and wrong in `en-US`.
 *
 * `Intl` throws on a currency the runtime does not recognise. That means the
 * data carries a bad code, not that rendering failed, so the price falls back to
 * the plain amount and the code instead of taking the page down.
 */
export function formatPrice(
  locale: string,
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
