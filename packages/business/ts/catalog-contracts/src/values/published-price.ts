import type { TransitionalFailure } from '@entifix/core';
import { Context, type Effect } from 'effect';

/**
 * What a sale is priced from: the published offering's vendor and unit price,
 * as the storefront shows it.
 */
export interface PublishedPrice {
  readonly offeringId: string;
  readonly vendorId: string;
  readonly amount: number;
  readonly currency: string;
}

/**
 * Reads the published price of one offering, or answers `undefined` when
 * nothing published answers to it.
 *
 * ⚠️ **A price comes from here and never from a request.** A host that sells
 * on somebody's behalf — the till, which presents a crossing token for the
 * vendor — must not let the caller name the money; it reads the same
 * projection the storefront charges a buyer against, which is what keeps one
 * price for one offering however it sells.
 *
 * A port, because the projection is another slice's store: the reader reaches
 * it through its anonymous read route, and which address that is belongs to
 * composition.
 */
export interface PublishedPriceReader {
  readonly priceOf: (
    offeringId: string,
  ) => Effect.Effect<PublishedPrice | undefined, TransitionalFailure>;
}

export class PublishedPriceReaderTag extends Context.Service<
  PublishedPriceReaderTag,
  PublishedPriceReader
>()('PublishedPriceReaderTag') {}

/**
 * The price a published-offering record carries, or `undefined` when the
 * record is missing or any of the three members a sale needs is not there.
 */
export const publishedPriceOf = (
  offeringId: string,
  record: Readonly<Record<string, unknown>> | undefined,
): PublishedPrice | undefined => {
  const vendorId = record?.['vendorId'];
  const amount = record?.['amount'];
  const currency = record?.['currency'];
  return typeof vendorId === 'string' &&
    typeof amount === 'number' &&
    typeof currency === 'string'
    ? { offeringId, vendorId, amount, currency }
    : undefined;
};
