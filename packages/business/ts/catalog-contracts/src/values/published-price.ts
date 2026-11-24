import type { Overloaded, UpstreamUnavailable } from '@entifix/core';
import {
  type PriceTier,
  priceTiersOf,
  type SaleTerms,
  saleTermsOf,
  type StockSource,
  stockSourceOf,
} from '@r10c/business-ts-sales-vocabulary';
import { Context, type Effect } from 'effect';

/**
 * What a sale is priced from: the published offering's vendor, name, price,
 * the terms it is sold on and the specification version it was published on,
 * as the storefront shows them. A quantity is checked against the terms and
 * the line's total is `lineTotal` over them (ADR 0082 §3, §6). The name, description and version are copied onto the sale's
 * line, so the order keeps what was sold after a rename or a new version
 * (#582, ADR 0079 §3).
 */
export interface PublishedPrice extends SaleTerms, Partial<StockSource> {
  readonly offeringId: string;
  readonly name: string;
  readonly description?: string;
  readonly vendorId: string;
  readonly amount: number;
  /**
   * Where the price steps down by quantity (ADR 0082 §8): a sale is charged
   * `tieredPrice` over these and `amount`, never `amount` alone.
   */
  readonly tiers?: readonly PriceTier[];
  readonly currency: string;
  readonly specificationId: string;
  readonly specificationVersion: number;
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
 * composition. A projection that cannot be read is `UpstreamUnavailable`,
 * and `Overloaded` once the retry budget for reading it is spent.
 */
export interface PublishedPriceReader {
  readonly priceOf: (
    offeringId: string,
  ) => Effect.Effect<
    PublishedPrice | undefined,
    UpstreamUnavailable | Overloaded
  >;
}

export class PublishedPriceReaderTag extends Context.Service<
  PublishedPriceReaderTag,
  PublishedPriceReader
>()('PublishedPriceReaderTag') {}

/**
 * The price a published-offering record carries, or `undefined` when the
 * record is missing or any member a sale needs is not there — the version it
 * was published on among them, since the line must say what was sold, and the
 * sale terms, since a price read without them is a price for one unit.
 */
export const publishedPriceOf = (
  offeringId: string,
  record: Readonly<Record<string, unknown>> | undefined,
): PublishedPrice | undefined => {
  const vendorId = record?.['vendorId'];
  const name = record?.['name'];
  const amount = record?.['amount'];
  const currency = record?.['currency'];
  const specificationId = record?.['specificationId'];
  const specificationVersion = record?.['specificationVersion'];
  const description = record?.['description'];
  const tiers = priceTiersOf(record?.['tiers']);
  const terms = saleTermsOf(record);
  // A presentation's base rides the sale's line, so the coordinator reserves
  // on it (ADR 0082 §7).
  const stock = record === undefined ? undefined : stockSourceOf(record);
  return terms !== undefined &&
    typeof vendorId === 'string' &&
    typeof name === 'string' &&
    name !== '' &&
    typeof amount === 'number' &&
    typeof currency === 'string' &&
    typeof specificationId === 'string' &&
    specificationId !== '' &&
    typeof specificationVersion === 'number'
    ? {
        offeringId,
        name,
        vendorId,
        amount,
        currency,
        specificationId,
        specificationVersion,
        ...terms,
        ...(tiers === undefined ? {} : { tiers }),
        ...stock,
        ...(typeof description === 'string' && description !== ''
          ? { description }
          : {}),
      }
    : undefined;
};
