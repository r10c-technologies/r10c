import { EntifixConnError } from '@entifix/core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { PublishedPriceReader } from '../values/published-price';

/**
 * How the published catalog behind a subject answers a lookup: a status and
 * the first record it lists, or `undefined` for a catalog that cannot be
 * reached at all.
 */
export type CatalogScript = (offeringId: string) =>
  | {
      readonly status: number;
      readonly record?: Readonly<Record<string, unknown>>;
    }
  | undefined;

/**
 * What every {@link PublishedPriceReader} must guarantee: a listed offering
 * reads back as its vendor, amount and currency, and anything that is not a
 * whole price — unlisted, refused, or a record missing a member — reads as no
 * price, so a sale is refused rather than priced at nothing. A catalog it
 * cannot reach is a connection error, not an absent price.
 *
 * `make` returns a subject whose catalog answers as `catalog` says.
 */
export const describePublishedPriceReaderContract = (
  name: string,
  make: (
    catalog: CatalogScript,
  ) => PublishedPriceReader | Promise<PublishedPriceReader>,
) => {
  describe(`${name} honours the PublishedPriceReader contract`, () => {
    const read = async (answer: ReturnType<CatalogScript>) => {
      const asked: string[] = [];
      const reader = await make(offeringId => {
        asked.push(offeringId);
        return answer;
      });
      const result = await Effect.runPromise(
        Effect.result(reader.priceOf('o-1')),
      );
      return { result, asked };
    };

    it('reads a listed offering as its price', async () => {
      const { result, asked } = await read({
        status: 200,
        record: { vendorId: 'v-1', amount: 7, currency: 'GTQ', name: 'Mug' },
      });

      expect(asked).toEqual(['o-1']);
      expect(result).toMatchObject({
        success: {
          offeringId: 'o-1',
          vendorId: 'v-1',
          amount: 7,
          currency: 'GTQ',
        },
      });
    });

    it('reads no price for an unlisted offering, a refusal, or a partial record', async () => {
      const answers = [
        { status: 200 },
        { status: 404 },
        {
          status: 200,
          record: { vendorId: 'v-1', amount: '7', currency: 'GTQ' },
        },
      ];

      for (const answer of answers) {
        expect((await read(answer)).result).toMatchObject({
          success: undefined,
        });
      }
    });

    it('reports a catalog it cannot reach as a connection error', async () => {
      expect((await read(undefined)).result).toMatchObject({
        failure: expect.any(EntifixConnError),
      });
    });
  });
};
