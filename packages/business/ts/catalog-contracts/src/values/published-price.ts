import type { Overloaded, UpstreamUnavailable } from '@entifix/core';
import {
  type SaleTerms,
  saleTermsOf,
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
export interface PublishedPrice extends SaleTerms {
  readonly offeringId: string;
  readonly name: string;
  readonly description?: string;
  readonly vendorId: string;
  readonly amount: number;
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
  const terms = saleTermsOf(record);
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
        ...(typeof description === 'string' && description !== ''
          ? { description }
          : {}),
      }
    : undefined;
};
