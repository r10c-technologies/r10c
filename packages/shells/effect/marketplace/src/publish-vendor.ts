import { EventBusTag, type Subscription } from '@entifix/transactions';
import { PublishedVendorsTag } from '@r10c/business-ts-marketplace-vendor';
import { readOrganizationAnnouncement } from '@r10c/business-ts-party-contracts';
import { Effect } from 'effect';

/**
 * Every organization event, on a work queue the marketplace owns: what fills
 * the sellers' names the storefront renders is auth-service announcing its
 * organizations (ADR 0061).
 */
export const vendorSubscription: Subscription = {
  slice: 'marketplace',
  pattern: 'organization.*',
  mode: 'work',
  maxAttempts: 5,
};

export const startProjectingVendors = Effect.gen(function* () {
  const bus = yield* EventBusTag;
  const vendors = yield* PublishedVendorsTag;

  yield* bus.subscribe(vendorSubscription, event =>
    Effect.flatMap(readOrganizationAnnouncement(event.data), announcement =>
      vendors.apply(announcement),
    ),
  );
});
