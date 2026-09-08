import {
  CATALOG_PUBLISHED,
  type CatalogPublication,
  readCatalogPublication,
} from '@r10c/business-ts-catalog-contracts';
import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { EventBusTag, type Subscription } from '@r10c/entifix-transactions';
import {
  EntifixConnError,
  type EntifixError,
  envelopeEntityName,
} from '@r10c/entifix-ts-core';
import { MongoDatabaseTag } from '@r10c/entifix-ts-mongo-client';
import { Effect } from 'effect';
import type { Db } from 'mongodb';

/**
 * The **subscribing** slice, never the emitting one.
 *
 * `EventSourceTag` names whoever published; this names who is owed the
 * messages, and it is what `queueNameFor` files the durable queue under. One
 * deployment can host several slices, so deriving the queue name from the
 * publisher would file this consumer's backlog under whichever slice happened
 * to share a process with it.
 */
const SUBSCRIBING_SLICE = 'marketplace';

/**
 * A **literal beside the register's declaration**, not a config value.
 *
 * It becomes the queue's `x-delivery-limit`, which is immutable once the queue
 * exists: re-declaring with a different ceiling fails `PRECONDITION_FAILED` and
 * closes the channel, with no safe automatic recovery. A tunable nothing can
 * adopt is worse than a constant, so the number lives here and in
 * `tools/slices/src/slices/marketplace.slice.ts`, and changing it means
 * deleting the queue — locally, `pnpm run mp:dev:reset`.
 */
const MAX_ATTEMPTS = 5;

/** The collection `makeMongoRepository` reads this projection back out of. */
const PROJECTION_COLLECTION = envelopeEntityName(PublishedOffering);

/**
 * Where an unpublication leaves its mark.
 *
 * ⚠️ **A delete on its own is not orderable, and that is why this exists.**
 * The write guard below compares an event against what is stored — but a
 * delete leaves nothing stored, so an *older* publication arriving afterwards
 * is indistinguishable from a first one and puts the listing back. Measured,
 * not theorised: publishing and unpublishing an offering 19ms apart raced two
 * inline outbox drains, the unpublication was delivered first, and the
 * storefront kept showing an offering whose tenant-side record said
 * `unpublished`.
 *
 * A separate collection rather than a `deleted` flag on the record itself,
 * because `published-catalog` is read by `makeMongoRepository` through the
 * entity's own collection and a soft-deleted row there would need every reader
 * to remember to filter it — the kind of rule that holds until the next reader.
 * ADR 0009 is also explicit that a `projection-of:` store must not keep rows its
 * source no longer has.
 */
const TOMBSTONE_COLLECTION = `${PROJECTION_COLLECTION}-tombstone`;

/**
 * The subscription this slice binds.
 *
 * **One pattern covering both names**, so a publication and an unpublication of
 * the same offering share a queue and therefore an order. Two subscriptions
 * would be two queues delivering independently, which is precisely how a
 * redelivered unpublication overtakes the publication that superseded it.
 *
 * **`work`, not `broadcast`.** The projection is this slice's system of record
 * for the published catalog, so the queue must be durable and must accumulate
 * while the service restarts — a message lost then is an offering the
 * storefront never shows and nothing can notice. A broadcast queue is anonymous
 * and dies with its connection.
 */
export const catalogSubscription: Subscription = {
  slice: SUBSCRIBING_SLICE,
  pattern: 'catalog.*',
  mode: 'work',
  maxAttempts: MAX_ATTEMPTS,
};

/** One document's ordering key, or the epoch when it has no usable one. */
const publishedAtOf = (stored: { publishedAt?: unknown } | null): number => {
  const value = stored?.publishedAt;
  if (value instanceof Date) return value.getTime();
  // A document written before `publishedAt` existed, or one whose value did not
  // survive a hand edit. The epoch, so every real publication supersedes it —
  // the opposite default would freeze such a record permanently, and comparing
  // against a string would yield `NaN`, which is false in every direction.
  return 0;
};

/**
 * Applies one publication to the projection.
 *
 * ⚠️ **Guarded on `publishedAt`, and that guard is the correctness half.**
 * Delivery is at-least-once and the emitter drains its outbox per request, so
 * two publications of the same offering can reach this handler in the order the
 * broker happened to deliver them rather than the order the vendor made them.
 * Left ungoverned, a redelivered or overtaking `catalog.unpublished` deletes a
 * listing that is legitimately live — permanently, silently, and with every
 * probe green.
 *
 * ⚠️ **The comparison is against the record *or its tombstone*.** Comparing
 * only against the stored record covers a publication losing to a newer one and
 * misses the case that actually happened: unpublish wins the race, the delete
 * finds nothing and leaves nothing, and the older publication that follows looks
 * like a first publication and puts the offering back on the storefront. The
 * tombstone is what gives a delete something to be ordered by.
 *
 * ⚠️ **Replaced wholesale, never merged.** ADR 0009: derived data with a
 * partial update path drifts from its source in ways nothing detects. A
 * republication is how a vendor's correction reaches the storefront, so the
 * document it writes must be the whole document.
 *
 * The write goes through the driver rather than `makeMongoRepository` because an
 * unpublication is a delete by `offeringId` and a publication is an upsert on
 * the same key — neither is a save by entity id, which is the only shape the
 * repository offers. The collection name is taken from the entity so the
 * projector and the read routes cannot disagree about it.
 */
export const applyPublication = (
  db: Db,
  eventName: string,
  publication: CatalogPublication,
): Effect.Effect<void, EntifixError> =>
  Effect.tryPromise({
    try: async () => {
      const records = db.collection(PROJECTION_COLLECTION);
      const tombstones = db.collection(TOMBSTONE_COLLECTION);
      const key = { offeringId: publication.offeringId };
      const at = new Date(publication.publishedAt);

      const [stored, tombstone] = (await Promise.all([
        records.findOne(key),
        tombstones.findOne(key),
      ])) as ({ publishedAt?: unknown } | null)[];

      // The latest thing this offering is known to have done, whichever shape
      // recorded it. An event older than that is out of order, whichever way it
      // would have moved the projection.
      const latest = Math.max(publishedAtOf(stored), publishedAtOf(tombstone));
      if (at.getTime() < latest) return;

      if (eventName !== CATALOG_PUBLISHED) {
        // Tombstone first: between the two writes the offering must never look
        // publishable again, and a delete that lands with no marker behind it is
        // the resurrection this guard exists to stop.
        await tombstones.replaceOne(
          key,
          { offeringId: publication.offeringId, publishedAt: at },
          { upsert: true },
        );
        await records.deleteOne(key);
        return;
      }

      const projected = new PublishedOffering(
        publication.offeringId,
        publication.vendorId,
        publication.name,
      );
      projected.amount = publication.amount;
      projected.currency = publication.currency;
      projected.availableHint = publication.availableHint;
      projected.publishedAt = at;
      // The offering's own id, so republishing an offering replaces its record
      // rather than accumulating one per publication.
      projected.id = publication.offeringId;

      await records.replaceOne(
        key,
        {
          id: projected.id,
          offeringId: projected.offeringId,
          vendorId: projected.vendorId,
          name: projected.name,
          amount: projected.amount,
          currency: projected.currency,
          availableHint: projected.availableHint,
          publishedAt: projected.publishedAt,
        },
        { upsert: true },
      );
      // The record now carries this moment, so the tombstone has nothing left to
      // order and would only make the next unpublication compare against a stale
      // value.
      await tombstones.deleteOne(key);
    },
    catch: error =>
      new EntifixConnError('Failed to write the published catalog', error, {
        offeringId: publication.offeringId,
        eventName,
      }),
  });

/**
 * Binds this slice's consumer: `catalog.*` in, `published-catalog` out.
 *
 * The boot effect, merged at the composition root the way marketplace-admin's
 * `startTracking` is. It forks no daemon, so it registers no shutdown hook —
 * `AmqpEventBusLayer` already registers the one that cancels consumers and
 * waits for in-flight deliveries.
 *
 * ⚠️ **Decoding is the first thing the handler does**, and that placement
 * decides a message's fate. `readCatalogPublication` rejecting makes this a
 * handler *failure*, which the adapter treats as transient and requeues — so
 * the decode is deliberately hoisted out of `Effect.tryPromise` and left to
 * fail on its own terms, where the log names the malformed members. A payload
 * the *adapter* cannot read never reaches here at all: that is poison, and it
 * is quarantined with zero retries (ADR 0030).
 */
export const startProjecting = Effect.gen(function* () {
  const bus = yield* EventBusTag;
  const db = yield* MongoDatabaseTag;

  yield* bus.subscribe(catalogSubscription, event =>
    Effect.flatMap(readCatalogPublication(event.data), publication =>
      applyPublication(db, event.name, publication),
    ),
  );
});
