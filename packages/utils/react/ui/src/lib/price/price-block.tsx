import { Stack, Text } from '@entifix/react-controls/primitives';

import { formatPrice } from './format-price.js';

/** An amount in minor units, and the currency it is in. */
export interface Money {
  readonly amount: number;
  readonly currency: string;
}

export interface PriceBlockProps {
  readonly locale: string;
  readonly price: Money;
  /**
   * The price per unit of measure, and the unit it is per, already translated
   * ("kg", "unidad"). Nothing fills it yet, because the snapshot carries no
   * unit to price by.
   */
  readonly unitPrice?: Money & { readonly per: string };
}

/** A price, and under it the unit price when there is one. */
export function PriceBlock({ locale, price, unitPrice }: PriceBlockProps) {
  return (
    <Stack gap="3xs">
      <Text weight="semibold">
        {formatPrice(locale, price.amount, price.currency)}
      </Text>
      {unitPrice === undefined ? null : (
        <Text muted step={-1}>
          {formatPrice(locale, unitPrice.amount, unitPrice.currency)}
          {' / '}
          {unitPrice.per}
        </Text>
      )}
    </Stack>
  );
}
