import { UpstreamUnavailable } from '@entifix/core';
import { Effect } from 'effect';

import {
  publishedPriceOf,
  type PublishedPriceReader,
} from '../values/published-price';
import type { CatalogScript } from './published-price-reader.contract';

/**
 * A {@link PublishedPriceReader} whose catalog answers as `catalog` says, for
 * the specs of whatever prices a sale. It runs
 * `describePublishedPriceReaderContract`, so a partial record reads as no
 * price here exactly as it does over HTTP.
 */
export const makeScriptedPublishedPriceReader = (
  catalog: CatalogScript,
): PublishedPriceReader => ({
  priceOf: offeringId =>
    Effect.suspend(() => {
      const answer = catalog(offeringId);
      if (answer === undefined || answer.status >= 500) {
        return Effect.fail(
          new UpstreamUnavailable({ upstream: 'marketplace-service' }),
        );
      }
      return Effect.succeed(
        answer.status === 200
          ? publishedPriceOf(offeringId, answer.record)
          : undefined,
      );
    }),
});
