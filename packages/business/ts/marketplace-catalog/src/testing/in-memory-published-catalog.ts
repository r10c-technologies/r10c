import { CATALOG_PUBLISHED } from '@r10c/business-ts-catalog-contracts';
import { Effect } from 'effect';

import type { PublishedCatalogSubject } from './published-catalog.contract';

/**
 * A published catalog held in memory, for the specs of whatever consumes the
 * port. It runs `describePublishedCatalogContract`, so it keeps a stamp per
 * offering and orders on it the way the Mongo projection does.
 */
export const makeInMemoryPublishedCatalog = (): PublishedCatalogSubject => {
  const stamps = new Map<string, number>();
  const listed = new Set<string>();

  return {
    catalog: {
      apply: (eventName, publication) =>
        Effect.sync(() => {
          const moment = new Date(publication.publishedAt).getTime();
          if (moment < (stamps.get(publication.offeringId) ?? 0)) {
            return 'stale';
          }
          stamps.set(publication.offeringId, moment);
          if (eventName === CATALOG_PUBLISHED) {
            listed.add(publication.offeringId);
          } else {
            listed.delete(publication.offeringId);
          }
          return 'applied';
        }),
    },
    isListed: offeringId => Promise.resolve(listed.has(offeringId)),
  };
};
