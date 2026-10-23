import type { Locale } from '@entifix/core';

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

/** A sum in one currency, in minor units. */
export interface MoneyTotal {
  readonly currency: string;
  readonly amount: number;
}

/**
 * Sum priced lines into one total per currency, in the order each currency
 * first appears.
 *
 * ⚠️ **One figure per currency, never one figure.** A basket can span vendors
 * pricing in different currencies, and there is no exchange rate in this
 * system, so adding them up would state a price nobody is charged. The cart and
 * the receipt both sum through here, so the figure a buyer reads before
 * checkout is the figure the receipt shows after it.
 */
export function totalsByCurrency(
  lines: readonly {
    readonly amount: number;
    readonly currency: string;
    readonly quantity: number;
  }[],
): MoneyTotal[] {
  const byCurrency = new Map<string, number>();
  for (const line of lines) {
    byCurrency.set(
      line.currency,
      (byCurrency.get(line.currency) ?? 0) + line.amount * line.quantity,
    );
  }
  return [...byCurrency].map(([currency, amount]) => ({ currency, amount }));
}
