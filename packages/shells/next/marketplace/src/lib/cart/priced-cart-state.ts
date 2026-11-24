import type { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import {
  lineTotal,
  stockSourceOf,
  tieredPrice,
} from '@r10c/business-ts-sales-vocabulary';

import { type MoneyTotal, totalsByCurrency } from '../catalog/money';
import { type CartRefusal, heldLineRefusal } from './cart-quantity';
import type { CartLine } from './cart-state';
import {
  type PricedLine,
  type SellerLines,
  sellerParts,
} from './checkout-start';

/** One cart line beside the published offering it was priced from. */
export interface PresentLine {
  readonly line: CartLine;
  readonly offering: PublishedOffering;
}

/** The cart priced from the catalog, as every step of a checkout reads it. */
export interface PricedCart {
  readonly present: readonly PresentLine[];
  readonly priced: readonly PricedLine[];
  readonly offerings: ReadonlyMap<string, PublishedOffering>;
  readonly parts: readonly SellerLines[];
  readonly totals: readonly MoneyTotal[];
  /** Lines in the cart whose offering is no longer published. */
  readonly unavailable: number;
  /**
   * The lines whose quantity the published terms no longer sell — a step or
   * a minimum the seller changed since the add — by offering id, with why.
   * The cart says so beside each, and no checkout starts while any is left
   * (ADR 0082 §3).
   */
  readonly refusals: ReadonlyMap<string, CartRefusal>;
}

/**
 * One cart line priced from its published offering: the volume price its
 * quantity reaches by `tieredPrice`, which prices the whole line, and where
 * that price starts (ADR 0082 §8).
 */
const pricedLineOf = (
  line: CartLine,
  offering: PublishedOffering,
): PricedLine => {
  const charged = tieredPrice(offering, line.quantity);
  return {
    offeringId: line.offeringId,
    name: offering.name,
    ...(offering.description === undefined || offering.description === ''
      ? {}
      : { description: offering.description }),
    // Every publication carries its pin (ADR 0079 §2); a row without one
    // predates the widening and is refused by the checkout's own schema.
    specificationId: offering.specificationId ?? '',
    specificationVersion: offering.specificationVersion ?? 0,
    vendorId: offering.vendorId,
    saleUnit: offering.saleUnit,
    quantity: line.quantity,
    amount: charged.amount,
    pricePer: offering.pricePer,
    ...(charged.tierFrom === undefined ? {} : { tierFrom: charged.tierFrom }),
    // The preview; the coordinator computes the figure charged (ADR 0082 §6).
    lineTotal: lineTotal({
      amount: charged.amount,
      pricePer: offering.pricePer,
      quantity: line.quantity,
      saleUnit: offering.saleUnit,
    }),
    currency: offering.currency,
    // A presentation draws on its base's stock (ADR 0082 §7).
    ...stockSourceOf({
      stockOfferingId: offering.stockOfferingId,
      stockFactor: offering.stockFactor,
      stockUnit: offering.stockUnit,
    }),
  };
};

/**
 * Prices the cart's lines from the offerings they name. A line whose offering
 * is gone — unpublished since it was added — is dropped and counted rather than
 * shown nameless, so the review can say what is not part of the order; totals
 * are summed over what is shown, so a dropped line never adds to a figure the
 * buyer cannot trace back to a row.
 */
export function pricedCartOf(
  items: readonly {
    readonly line: CartLine;
    readonly offering: PublishedOffering | undefined;
  }[],
): PricedCart {
  const present: PresentLine[] = items.flatMap(({ line, offering }) =>
    offering === undefined ? [] : [{ line, offering }],
  );
  const priced: PricedLine[] = present.map(({ line, offering }) =>
    pricedLineOf(line, offering),
  );
  return {
    present,
    priced,
    offerings: new Map(
      present.map(({ line, offering }) => [line.offeringId, offering]),
    ),
    // One part per seller, in the order each first appears: a checkout writes
    // one order per vendor, and the buyer picks a tender for each at review
    // (ADR 0070, ADR 0076 §7).
    parts: sellerParts(priced),
    totals: totalsByCurrency(priced),
    unavailable: items.length - present.length,
    refusals: new Map(
      present.flatMap(({ line, offering }) => {
        const refusal = heldLineRefusal(offering, line.quantity);
        return refusal === undefined ? [] : [[line.offeringId, refusal]];
      }),
    ),
  };
}

/**
 * The totals a buyer reviewed, as one comparable string — what the review
 * posts beside Place order, and what the checkout re-prices against. A price
 * that moved, or a line that stopped being sold, changes it.
 */
export const reviewedTotalsOf = (totals: readonly MoneyTotal[]): string =>
  totals
    .map(({ currency, amount }) => `${currency}:${String(amount)}`)
    .join(';');
