import {
  EntifixConnError,
  envelopeEntityName,
  serializeEntity,
} from '@entifix/core';
import { MongoDatabaseTag } from '@entifix/mongo';
import { MongoUnitOfWorkTag } from '@entifix/mongo/transactions';
import {
  CATALOG_PUBLISHED,
  type CatalogPublication,
} from '@r10c/business-ts-catalog-contracts';
import {
  PublishedCatalogTag,
  PublishedOffering,
} from '@r10c/business-ts-marketplace-catalog';
import { Effect, Layer } from 'effect';
import type { Db } from 'mongodb';

export const PROJECTION_COLLECTION = envelopeEntityName(PublishedOffering);

/**
 * The latest moment each offering is known to have done anything —
 * published or come down — one document per offering, kept in both cases.
 */
export const STAMP_COLLECTION = `${PROJECTION_COLLECTION}-stamp`;

const momentOf = (stamp: { publishedAt?: unknown } | null): number =>
  // A stamp whose value did not survive a hand edit is no moment at all: the
  // epoch, so a real publication supersedes it. Comparing against a string
  // would yield `NaN`, false in every direction, and freeze the offering.
  stamp?.publishedAt instanceof Date ? stamp.publishedAt.getTime() : 0;

const failed =
  (publication: CatalogPublication, eventName: string) => (error: unknown) =>
    new EntifixConnError('Failed to write the published catalog', error, {
      offeringId: publication.offeringId,
      eventName,
    });

/** What the storefront reads: the snapshot, keyed on the offering. */
const recordOf = (publication: CatalogPublication, at: Date) => {
  const projected = new PublishedOffering(
    publication.offeringId,
    publication.vendorId,
    publication.name,
  );
  projected.amount = publication.amount;
  projected.currency = publication.currency;
  projected.availableHint = publication.availableHint;
  projected.publishedAt = at;
  projected.code = publication.code;
  projected.description = publication.description;
  projected.brandId = publication.brandId;
  projected.categoryId = publication.categoryId;
  projected.media = publication.media;
  // The offering's own id, so republishing replaces rather than accumulates.
  projected.id = publication.offeringId;
  // `serializeEntity`, never a literal: it keys by `alias ?? name`, the keys
  // the repository reads back, and omits `undefined` rather than storing
  // `null`. It skips `hidden`/`readonly` accessors, which is why the spec
  // asserts the document against the payload's own members.
  return serializeEntity(PublishedOffering, projected);
};

/** The stamp's unique index: one ordering document per offering. */
export const ensurePublishedCatalogIndexes = (db: Db) =>
  Effect.tryPromise({
    try: () =>
      db
        .collection(STAMP_COLLECTION)
        .createIndex({ offeringId: 1 }, { unique: true }),
    catch: error =>
      new EntifixConnError('Failed to index the published catalog', error),
  });

/**
 * The projector's write, **ordered on the event's own `publishedAt`** and
 * correct under concurrency (#357).
 *
 * ⚠️ **Every apply writes the stamp, whichever way it moves the record.** The
 * read, the comparison and both writes run in one transaction, and two
 * transactions only conflict when they write the *same* document. A publish
 * and an unpublish racing on a fresh offering would otherwise touch two
 * different documents — one inserting the record, the other a tombstone —
 * both commit, and the offering is resurrected with every probe green. The
 * stamp is the one document both must write, so the server aborts one with a
 * write conflict, the unit of work retries it, and the retry reads the newer
 * stamp and goes stale.
 *
 * Equal is not older: an exact redelivery re-applies, which writes the same
 * document — the idempotence the register's `natural` dedupe rests on.
 */
export const MongoPublishedCatalogLayer = Layer.effect(
  PublishedCatalogTag,
  Effect.gen(function* () {
    const db = yield* MongoDatabaseTag;
    const units = yield* MongoUnitOfWorkTag;
    yield* ensurePublishedCatalogIndexes(db);

    return {
      apply: (eventName, publication) =>
        Effect.gen(function* () {
          const at = new Date(publication.publishedAt);
          const key = { offeringId: publication.offeringId };
          const fail = failed(publication, eventName);

          const outcome = yield* units.run(unit =>
            Effect.tryPromise({
              try: async () => {
                const { db: handle, session } = unit.handle;
                const stamps = handle.collection(STAMP_COLLECTION);
                const records = handle.collection(PROJECTION_COLLECTION);

                const stamp = (await stamps.findOne(key, { session })) as {
                  publishedAt?: unknown;
                } | null;
                if (at.getTime() < momentOf(stamp)) return 'stale' as const;

                await stamps.replaceOne(
                  key,
                  { offeringId: publication.offeringId, publishedAt: at },
                  { upsert: true, session },
                );
                await (eventName === CATALOG_PUBLISHED
                  ? records.replaceOne(key, recordOf(publication, at), {
                      upsert: true,
                      session,
                    })
                  : records.deleteOne(key, { session }));
                return 'applied' as const;
              },
              catch: fail,
            }),
          );
          // Always committed: the unit takes no claim, so it is never a
          // duplicate, and its body never aborts. A driver failure is the
          // unit's own error channel.
          return (outcome as Extract<typeof outcome, { _tag: 'committed' }>)
            .value;
        }),
    };
  }),
);
