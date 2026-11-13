import type { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';

import { type MoneyTotal, totalsByCurrency } from '../catalog/money';
import type { CartLine } from './cart-state';
import {
  type PricedLine,
  type SellerPart,
  sellerParts,
  type Tender,
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
  readonly parts: readonly SellerPart[];
  readonly totals: readonly MoneyTotal[];
  /** Lines in the cart whose offering is no longer published. */
  readonly unavailable: number;
}

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
  tender: (vendorId: string) => Tender = () => 'card',
): PricedCart {
  const present: PresentLine[] = items.flatMap(({ line, offering }) =>
    offering === undefined ? [] : [{ line, offering }],
  );
  const priced: PricedLine[] = present.map(({ line, offering }) => ({
    offeringId: line.offeringId,
    vendorId: offering.vendorId,
    quantity: line.quantity,
    amount: offering.amount,
    currency: offering.currency,
  }));
  return {
    present,
    priced,
    offerings: new Map(
      present.map(({ line, offering }) => [line.offeringId, offering]),
    ),
    // One part per seller, in the order each first appears: a checkout writes
    // one order per vendor, and the buyer picks a tender for each (ADR 0070).
    parts: sellerParts(priced, tender),
    totals: totalsByCurrency(priced),
    unavailable: items.length - present.length,
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
