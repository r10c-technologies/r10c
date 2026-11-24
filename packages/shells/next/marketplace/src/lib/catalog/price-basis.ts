import type { Locale } from '@entifix/core';
import {
  formatQuantity,
  oneWholeUnit,
  type PriceBasis,
  quotedQuantity,
  SALE_UNIT_SYMBOL_KEY,
  type SaleRule,
  type SaleUnit,
  type StockSource,
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

/**
 * A quantity with its unit, worded for `locale`: "3.5 m", "2 u.". Every place
 * the storefront shows a line's quantity shows this, because `3500` alone is
 * neither 3.5 m nor 3,500 of anything (ADR 0082 §2).
 */
export const quantityLabel =
  (t: Translate, locale: Locale) =>
  (quantity: number, saleUnit: SaleUnit): string =>
    t('storefront.price.quantity', {
      quantity: formatQuantity(quantity, saleUnit, locale),
      symbol: t(`${SALE_UNIT_SYMBOL_KEY}.${saleUnit}`),
    });

/**
 * How an offering not sold one whole unit at a time is sold — "Desde 1 m, de
 * 0.5 m en 0.5 m" — or `undefined` for one that is, which the field's own
 * unit already says. Shown beside every quantity field, so a refusal is
 * never the first the buyer hears of the rule.
 */
export const saleRuleLabel =
  (t: Translate, locale: Locale) =>
  (rule: SaleRule): string | undefined => {
    const whole = oneWholeUnit(rule.saleUnit);
    if (rule.quantityStep === whole && rule.quantityMinimum === whole)
      return undefined;
    const label = quantityLabel(t, locale);
    return t('storefront.price.sold', {
      minimum: label(rule.quantityMinimum, rule.saleUnit),
      step: label(rule.quantityStep, rule.saleUnit),
    });
  };

/**
 * What one presentation holds of its base — "Contiene 100 m" — or `undefined`
 * for an offering that draws on no base (ADR 0082 §7). The factor is the
 * base's quantity in the base's scale, so it reads as the base is sold.
 */
export const presentationLabel =
  (t: Translate, locale: Locale) =>
  (offering: {
    readonly stockFactor?: StockSource['stockFactor'] | undefined;
    readonly stockUnit?: StockSource['stockUnit'] | undefined;
  }): string | undefined =>
    offering.stockFactor === undefined || offering.stockUnit === undefined
      ? undefined
      : t('storefront.price.contains', {
          quantity: quantityLabel(t, locale)(
            offering.stockFactor,
            offering.stockUnit,
          ),
        });
