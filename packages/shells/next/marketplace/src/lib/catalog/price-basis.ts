import type { Locale } from '@entifix/core';
import {
  formatQuantity,
  oneWholeUnit,
  type PriceBasis,
  quotedQuantity,
  SALE_UNIT_SYMBOL_KEY,
} from '@r10c/business-ts-sales-vocabulary';

/** The slice of a translate function the label needs. */
type Translate = (
  key: string,
  values?: Readonly<Record<string, string>>,
) => string;

/**
 * What a price buys, worded for `locale` through `t` (the page's `r10c`
 * translator): "por m", "por 100 u." — or `undefined` for one piece, which a
 * bare price already says. Every place the storefront shows a published price
 * shows this beside it, because Q7.50 the hundred read alone is Q7.50 each
 * (ADR 0082 §5).
 */
export const priceBasisLabel =
  (t: Translate, locale: Locale) =>
  (basis: PriceBasis): string | undefined => {
    const quoted = quotedQuantity(basis);
    if (quoted === undefined) return undefined;
    const symbol = t(`${SALE_UNIT_SYMBOL_KEY}.${quoted.saleUnit}`);
    return quoted.quantity === oneWholeUnit(quoted.saleUnit)
      ? t('storefront.price.per', { symbol })
      : t('storefront.price.perQuantity', {
          quantity: formatQuantity(quoted.quantity, quoted.saleUnit, locale),
          symbol,
        });
  };
