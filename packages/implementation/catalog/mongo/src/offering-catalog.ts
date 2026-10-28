import {
  type TenantDatabaseResolver,
  TenantDatabaseResolverTag,
} from '@entifix/business';
import {
  envelopeEntityName,
  serializeEntity,
  Unavailable,
} from '@entifix/core';
import { MongoClientTag } from '@entifix/mongo';
import {
  drainOutboxNow,
  ensureOutboxIndexes,
  makeMongoOutbox,
  makeMongoUnitsOfWork,
  OutboxMaxAttempts,
  reviveQuarantined,
} from '@entifix/mongo/transactions';
import { EventBusTag } from '@entifix/transactions';
import {
  OfferingCatalogTag,
  ProductOffering,
} from '@r10c/business-ts-product-configuration-management';
import { Effect, Layer } from 'effect';
import type { Db } from 'mongodb';

export const OFFERING_COLLECTION = envelopeEntityName(ProductOffering);

/** The stored status moved under this transition: the compare-and-set missed. */
class OfferingMoved {
  readonly _tag = 'OfferingMoved';
}

/**
 * The `catalog` store's two writes that are not a save, over the
 * organization's own `tenant_<id>` database.
 *
 * ⚠️ **The transition is a status compare-and-set.** It was a plain replace,
 * so two publishes racing on one offering both read `draft`, both wrote, and
 * both emitted `catalog.published` — two announcements, and an unpublish that
 * lost the race could overwrite a publish that won it (#371). The replace now
 * names the status the decision was read in; a miss rolls the unit back,
 * outbox entry and all, and answers `changed`.
 *
 * The event drains right after the commit rather than waiting for the sweep,
 * so a publish reaches the storefront in milliseconds.
 */
export const MongoOfferingCatalogLayer = Layer.effect(
  OfferingCatalogTag,
  Effect.gen(function* () {
    const client = yield* MongoClientTag;
    const resolver =
      (yield* TenantDatabaseResolverTag) as TenantDatabaseResolver<Db>;
    const bus = yield* EventBusTag;
    const maxAttempts = yield* OutboxMaxAttempts;
    const units = makeMongoUnitsOfWork(client);
    const indexed: string[] = [];

    /** The organization's database, its outbox indexes ensured once. */
    const databaseOf = (organizationId: string) =>
      Effect.gen(function* () {
        const db = yield* resolver.forOrganization(organizationId);
        if (indexed.indexOf(db.databaseName) === -1) {
          yield* ensureOutboxIndexes(db);
          indexed.push(db.databaseName);
        }
        return db;
      });

    return {
      commitTransition: (organizationId, offering, from, event) =>
        Effect.gen(function* () {
          const db = yield* databaseOf(organizationId);
          const document = {
            ...serializeEntity(ProductOffering, offering),
            id: offering.id,
          };
          const outcome = yield* units.forDatabase(db).run(
            unit =>
              Effect.gen(function* () {
                const written = yield* Effect.tryPromise({
                  try: () =>
                    unit.handle.db
                      .collection(OFFERING_COLLECTION)
                      .replaceOne({ id: offering.id, status: from }, document, {
                        session: unit.handle.session,
                      }),
                  catch: () => new Unavailable({ dependency: 'mongo' }),
                });
                if (written.matchedCount === 0) {
                  return yield* Effect.fail(new OfferingMoved());
                }
                unit.emit(event);
              }),
            {
              afterCommit: drainOutboxNow(db).pipe(
                Effect.provideService(EventBusTag, bus),
                Effect.provideService(OutboxMaxAttempts, maxAttempts),
              ),
            },
          );
          return outcome._tag === 'committed'
            ? ('committed' as const)
            : ('changed' as const);
        }),

      reannounce: (organizationId, event) =>
        Effect.gen(function* () {
          const db = yield* databaseOf(organizationId);
          const enqueued = yield* makeMongoOutbox(db).enqueue(event);
          if (enqueued === 'enqueued') return 'announced' as const;
          // Already on the outbox. Quarantined after its delivery attempts ran
          // out is the case a rebuild exists for, so it is given another life.
          return (yield* reviveQuarantined(db, event.id))
            ? ('revived' as const)
            : ('alreadyAnnounced' as const);
        }),
    };
  }),
);
