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
