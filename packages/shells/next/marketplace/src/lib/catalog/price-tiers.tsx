import type { Locale } from '@entifix/core';
import { Money, Stack, Text } from '@entifix/react-controls/primitives';

/** The copy the table states, resolved on the server in the buyer's locale. */
export interface PriceTiersLabels {
  readonly heading: string;
  readonly caption: string;
  readonly quantity: string;
  readonly price: string;
}

/** One row: the quantities it covers, worded, and what they are charged. */
export interface PriceTierRowView {
  readonly quantity: string;
  readonly amount: number;
}

/**
 * The volume prices an offering steps down by, as a table a buyer reads
 * before choosing a quantity (ADR 0082 §8): the base price first, then each
 * tier from where it starts. A native table with a caption, so a screen
 * reader announces what the columns mean; nothing when there are no tiers.
 */
export function PriceTiers({
  rows,
  currency,
  locale,
  priceBasis,
  labels,
}: {
  readonly rows: readonly PriceTierRowView[];
  readonly currency: string;
  readonly locale: Locale;
  /** What each price buys, "por m", beside every amount; absent for one piece. */
  readonly priceBasis?: string;
  readonly labels: PriceTiersLabels;
}) {
  if (rows.length < 2) return null;
  return (
    <Stack gap="3xs" data-testid="price-tiers">
      <table className="text-step--1 w-full border-collapse">
        <caption className="text-start">
          <Text as="span" weight="semibold">
            {labels.heading}
          </Text>{' '}
          <Text as="span" muted>
            {labels.caption}
          </Text>
        </caption>
        <thead>
          <tr>
            <th scope="col" className="py-3xs text-start font-medium">
              {labels.quantity}
            </th>
            <th scope="col" className="py-3xs text-end font-medium">
              {labels.price}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.quantity} className="border-t border-border">
              <th scope="row" className="py-3xs text-start font-normal">
                {row.quantity}
              </th>
              <td className="py-3xs text-end">
                <Money
                  amount={row.amount}
                  currency={currency}
                  unit="minor"
                  locale={locale}
                />
                {priceBasis === undefined ? null : (
                  <Text as="span" muted className="ms-2xs">
                    {priceBasis}
                  </Text>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Stack>
  );
}
