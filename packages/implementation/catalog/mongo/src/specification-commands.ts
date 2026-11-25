import {
  type TenantDatabaseResolver,
  TenantDatabaseResolverTag,
} from '@entifix/business';
import {
  bumpRevision,
  deserializeSingleEntity,
  envelopeEntityName,
  serializeEntity,
  Unavailable,
} from '@entifix/core';
import { MongoClientTag } from '@entifix/mongo';
import {
  makeMongoUnitsOfWork,
  mongoUnitFault,
} from '@entifix/mongo/transactions';
import {
  ProductSpecification,
  SpecificationCommandsTag,
} from '@r10c/business-ts-product-configuration-management';
import { Effect, Layer, Option } from 'effect';
import type { ClientSession, Db } from 'mongodb';

import { atRevision } from './at-revision.js';

export const SPECIFICATION_COLLECTION =
  envelopeEntityName(ProductSpecification);

/** Where each organization's counters live, beside the records they number. */
export const COUNTERS_COLLECTION = 'counters';

/** The counter a specification's code is drawn from, and the code's prefix. */
const COUNTER = 'specification-code';
const CODE_PREFIX = 'product';

interface Counter {
  readonly _id: string;
  readonly value: number;
}

/** A driver call inside the unit, failing as the store fault it is. */
const store = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    // A store fault, so the unit of work rolls back and surfaces it — or, for
    // a write conflict, runs the unit again — rather than reading it as the
    // body's own abort.
    catch: () => new Unavailable({ dependency: 'mongo' }),
  });

/**
 * The organization's next specification code, drawn inside `session`: the
 * `$inc` commits with whatever the unit writes, so two draws racing on one
 * counter conflict and one reruns, and a unit that fails spends none. The
 * create and the catalog import (ADR 0084) draw from this one counter.
 */
export const drawSpecificationCode = (db: Db, session: ClientSession) =>
  Effect.gen(function* () {
    const counter = yield* store(() =>
      db
        .collection<Counter>(COUNTERS_COLLECTION)
        .findOneAndUpdate(
          { _id: COUNTER },
          { $inc: { value: 1 } },
          { upsert: true, returnDocument: 'after', session },
        ),
    );
    // An upserting `findOneAndUpdate` answers the document it wrote.
    const next = (counter as Counter).value;
    return `${CODE_PREFIX}-${String(next).padStart(3, '0')}`;
  });

/**
 * The one index that makes a version number unique within its series: two
 * revises racing on one key both read version `n` and both write `n + 1`, and
 * this is what refuses the second.
 */
export const ensureSpecificationIndexes = (db: Db) =>
  store(() =>
    db
      .collection(SPECIFICATION_COLLECTION)
      .createIndex({ specKey: 1, version: 1 }, { unique: true }),
  ).pipe(Effect.asVoid);

/**
 * Writes the specification with the next code of its organization's counter,
 * in one unit of work: the `$inc` and the record commit together, so two
 * creates racing on one counter conflict and one reruns, and a failed write
 * spends no code.
 */
const createIn = (
  db: Db,
  units: ReturnType<typeof makeMongoUnitsOfWork>,
  specification: ProductSpecification,
  idempotencyKey: string | undefined,
) =>
  units.forDatabase(db).run(
    unit =>
      Effect.gen(function* () {
        const { session } = unit.handle;
        specification.code = yield* drawSpecificationCode(
          unit.handle.db,
          session,
        );
        specification.id ??= globalThis.crypto.randomUUID();
        // The first version of a series: the key is the code it was drawn
        // with, and every later version copies both (ADR 0079 §1).
        specification.specKey = specification.code;
        // The revision check's first revision, as the repository's own create
        // writes it — without it the first `PUT` names no revision the
        // stored record holds, and every edit of a new product is refused.
        specification.revision = 1;
        const document = serializeEntity(ProductSpecification, specification);
        yield* store(() =>
          unit.handle.db
            .collection(SPECIFICATION_COLLECTION)
            .insertOne({ ...document, id: specification.id }, { session }),
        );
        return specification;
      }),
    idempotencyKey === undefined
      ? {}
      : {
          claim: { kind: 'command', commandId: idempotencyKey },
          replay: created => serializeEntity(ProductSpecification, created),
        },
  );

/** The stored lifecycle moved under this write: the compare-and-set missed. */
class SpecificationMoved {
  readonly _tag = 'SpecificationMoved';
}

/** Whether a driver error is a unique-index refusal. */
const isDuplicateKey = (error: unknown) =>
  (error as { readonly code?: unknown } | null)?.code === 11000;

/**
 * A specification's create as a plain unit of work on the organization's own
 * `tenant_<id>` database (ADR 0066 retired the single-step engine it ran
 * through). A repeated `Idempotency-Key` answers the record the first create
 * wrote, read back from the claim, and draws no code.
 */
export const MongoSpecificationCommandsLayer = Layer.effect(
  SpecificationCommandsTag,
  Effect.gen(function* () {
    const client = yield* MongoClientTag;
    const resolver =
      (yield* TenantDatabaseResolverTag) as TenantDatabaseResolver<Db>;
    const units = makeMongoUnitsOfWork(client);

    const indexed: string[] = [];

    /**
     * The organization's database, with the one index that makes a version
     * number unique within its series: two revises racing on one key both
     * read version `n` and both write `n + 1`, and this is what refuses the
     * second.
     */
    const databaseOf = (organizationId: string) =>
      Effect.gen(function* () {
        const db = yield* resolver.forOrganization(organizationId);
        if (indexed.indexOf(db.databaseName) === -1) {
          yield* ensureSpecificationIndexes(db);
          indexed.push(db.databaseName);
        }
        return db;
      });

    return {
      move: (organizationId, specification, from) =>
        Effect.gen(function* () {
          const db = yield* databaseOf(organizationId);
          // Everything but the identity and the revision, which moves in the
          // same write rather than being restated from what was read.
          const fields: Record<string, unknown> = {
            ...serializeEntity(ProductSpecification, specification),
          };
          delete fields['id'];
          delete fields['revision'];
          const outcome = yield* units.forDatabase(db).run(unit =>
            Effect.gen(function* () {
              const { session } = unit.handle;
              const specifications = unit.handle.db.collection(
                SPECIFICATION_COLLECTION,
              );
              const written = yield* Effect.tryPromise({
                try: () =>
                  specifications.findOneAndUpdate(
                    {
                      id: specification.id,
                      lifecycleStatus: from,
                      // A save leaves the status where it was, and `fields`
                      // would write over it: the revision is what sees one.
                      ...atRevision(specification.revision),
                    },
                    { $set: fields, ...bumpRevision.mongo },
                    { returnDocument: 'after', session },
                  ),
                catch: mongoUnitFault,
              });
              if (written === null) {
                return yield* Effect.fail(new SpecificationMoved());
              }
              // A release retires the version it replaces, in the same unit:
              // one active version per key, never two and never a gap.
              if (specification.lifecycleStatus === 'active') {
                yield* Effect.tryPromise({
                  try: () =>
                    specifications.updateOne(
                      {
                        specKey: specification.specKey,
                        lifecycleStatus: 'active',
                        id: { $ne: specification.id },
                      },
                      {
                        $set: {
                          lifecycleStatus: 'retired',
                          validTo: specification.validFrom,
                        },
                        ...bumpRevision.mongo,
                      },
                      { session },
                    ),
                  catch: mongoUnitFault,
                });
              }
              return (written as { readonly revision?: number }).revision;
            }),
          );
          if (outcome._tag !== 'committed') return 'changed' as const;
          specification.revision = outcome.value;
          return 'committed' as const;
        }),

      revise: (organizationId, next) =>
        Effect.gen(function* () {
          const db = yield* databaseOf(organizationId);
          next.revision = 1;
          const document = serializeEntity(ProductSpecification, next);
          return yield* Effect.tryPromise({
            try: () =>
              db
                .collection(SPECIFICATION_COLLECTION)
                .insertOne({ ...document, id: next.id }),
            catch: error => error,
          }).pipe(
            Effect.as('committed' as const),
            Effect.catch(error =>
              isDuplicateKey(error)
                ? Effect.succeed('changed' as const)
                : Effect.fail(new Unavailable({ dependency: 'mongo' })),
            ),
          );
        }),

      remove: (organizationId, id) =>
        Effect.gen(function* () {
          const db = yield* databaseOf(organizationId);
          const specifications = db.collection(SPECIFICATION_COLLECTION);
          const deleted = yield* store(() =>
            specifications.deleteOne({ id, lifecycleStatus: 'in-design' }),
          );
          if (deleted.deletedCount === 1) return 'removed' as const;
          // The write decided; this read only names the refusal.
          const stored = yield* store(() =>
            specifications.findOne({ id }, { projection: { _id: 0, id: 1 } }),
          );
          return stored === null ? ('absent' as const) : ('changed' as const);
        }),

      create: (organizationId, specification, idempotencyKey) =>
        Effect.gen(function* () {
          const db = yield* databaseOf(organizationId);
          const outcome = yield* createIn(
            db,
            units,
            specification,
            idempotencyKey,
          );
          if (outcome._tag === 'committed') return outcome.value;
          // A unit whose body cannot abort ends `duplicate` or committed.
          const replayed = Option.getOrUndefined(
            (outcome as { readonly replay: Option.Option<unknown> }).replay,
          );
          return (yield* deserializeSingleEntity(
            ProductSpecification,
            replayed,
          ).pipe(
            // A stored answer that will not revive is the store failing.
            Effect.mapError(() => new Unavailable({ dependency: 'mongo' })),
          )) as ProductSpecification;
        }),
    };
  }),
);
