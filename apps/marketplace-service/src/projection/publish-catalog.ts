import { EventBusTag, type Subscription } from '@entifix/transactions';
import { readCatalogPublication } from '@r10c/business-ts-catalog-contracts';
import { PublishedCatalogTag } from '@r10c/business-ts-marketplace-catalog';
import { Effect } from 'effect';

/**
 * The published catalog's subscription. **One pattern covering both names**,
 * so publications and unpublications share one queue and one order — two
 * subscriptions would deliver independently, which is how a redelivered
 * unpublication overtakes the publication that superseded it.
 *
 * A durable `work` queue filed under the **subscribing** slice: the projection
 * is this slice's system of record for the published catalog, and a broadcast
 * queue would drop whatever was published while the service restarted.
 * `maxAttempts` is a literal because `x-delivery-limit` is immutable once the
 * queue exists.
 */
export const catalogSubscription: Subscription = {
  slice: 'marketplace',
  pattern: 'catalog.*',
  mode: 'work',
  maxAttempts: 5,
};

/** Feed every publication into the projection, which orders them (#357). */
export const startProjecting = Effect.gen(function* () {
  const bus = yield* EventBusTag;
  const catalog = yield* PublishedCatalogTag;

  yield* bus.subscribe(catalogSubscription, event =>
    Effect.flatMap(readCatalogPublication(event.data), publication =>
      catalog.apply(event.name, publication),
    ),
  );
});
