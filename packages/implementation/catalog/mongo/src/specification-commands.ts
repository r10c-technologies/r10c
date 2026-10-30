import {
  type TenantDatabaseResolver,
  TenantDatabaseResolverTag,
} from '@entifix/business';
import {
  deserializeSingleEntity,
  envelopeEntityName,
  serializeEntity,
  Unavailable,
} from '@entifix/core';
import { MongoClientTag } from '@entifix/mongo';
import { makeMongoUnitsOfWork } from '@entifix/mongo/transactions';
import {
  ProductSpecification,
  SpecificationCommandsTag,
} from '@r10c/business-ts-product-configuration-management';
import { Effect, Layer, Option } from 'effect';
import type { Db } from 'mongodb';

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
        const counter = yield* store(() =>
          unit.handle.db
            .collection<Counter>(COUNTERS_COLLECTION)
            .findOneAndUpdate(
              { _id: COUNTER },
              { $inc: { value: 1 } },
              { upsert: true, returnDocument: 'after', session },
            ),
        );
        // An upserting `findOneAndUpdate` answers the document it wrote.
        const next = (counter as Counter).value;
        specification.id ??= globalThis.crypto.randomUUID();
        specification.code = `${CODE_PREFIX}-${String(next).padStart(3, '0')}`;
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

    return {
      create: (organizationId, specification, idempotencyKey) =>
        Effect.gen(function* () {
          const db = yield* resolver.forOrganization(organizationId);
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
