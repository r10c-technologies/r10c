import { Effect } from 'effect';

import type { PublishedVendorsSubject } from './published-vendors.contract';

/**
 * The published vendors held in memory, for the specs of whatever consumes
 * the port. It runs `describePublishedVendorsContract`, so it orders on each
 * vendor's announcement moment the way the Mongo projection does.
 */
export const makeInMemoryPublishedVendors = (): PublishedVendorsSubject => {
  const vendors = new Map<string, { name: string; moment: number }>();

  return {
    vendors: {
      apply: announcement =>
        Effect.sync(() => {
          const moment = new Date(announcement.announcedAt).getTime();
          const current = vendors.get(announcement.organizationId);
          if (current !== undefined && moment < current.moment) return 'stale';
          vendors.set(announcement.organizationId, {
            name: announcement.displayName,
            moment,
          });
          return 'applied';
        }),
    },
    displayNameOf: vendorId => Promise.resolve(vendors.get(vendorId)?.name),
  };
};
