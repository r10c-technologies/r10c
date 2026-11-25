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
import {
  drainOutboxNow,
  ensureOutboxIndexes,
  makeMongoUnitsOfWork,
  mongoUnitFault,
  readCommandReplay,
} from '@entifix/mongo/transactions';
import { EventBusTag, OutboxMaxAttempts } from '@entifix/transactions';
import {
  CatalogImport,
  CatalogImportCommandsTag,
  type ImportedRowOutcome,
  ProductOffering,
  ProductOfferingPrice,
  ProductSpecification,
} from '@r10c/business-ts-product-configuration-management';
import { Effect, Layer, Option } from 'effect';
import type { Db } from 'mongodb';

import { OFFERING_COLLECTION, PRICE_COLLECTION } from './offering-catalog.js';
import {
  drawSpecificationCode,
  ensureSpecificationIndexes,
  SPECIFICATION_COLLECTION,
} from './specification-commands.js';

export const CATALOG_IMPORT_COLLECTION = envelopeEntityName(CatalogImport);

/** The ids a row's claim is answered with. */
interface RowReplay {
  readonly specificationId: string;
  readonly offeringId: string;
}

/**
 * A driver call inside the unit, failing as the unit reads a fault: a write
 * conflict reruns the unit, anything else rolls it back.
 */
const store = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: mongoUnitFault });

/** A stored answer that will not read back is the store failing. */
const unreadable = () => new Unavailable({ dependency: 'mongo' });

const asReplay = (value: unknown): RowReplay | undefined => {
  const { specificationId, offeringId } = (value ?? {}) as Partial<RowReplay>;
  return typeof specificationId === 'string' && typeof offeringId === 'string'
    ? { specificationId, offeringId }
    : undefined;
};

/**
 * The catalog import's writes, over the organization's own `tenant_<id>`
 * database (ADR 0084 §4).
 *
 * Each row is **one unit of work claimed by its key**: the code drawn from the
 * counter a create draws from, the specification, the offering, the price and
 * — for a sheet put on sale — the announcement, all in one transaction, so a
 * failure leaves nothing and a second attempt answers what the first wrote. A
 * publication drains right after the commit, as a publish does.
 */
export const MongoCatalogImportCommandsLayer = Layer.effect(
  CatalogImportCommandsTag,
  Effect.gen(function* () {
    const client = yield* MongoClientTag;
    const resolver =
      (yield* TenantDatabaseResolverTag) as TenantDatabaseResolver<Db>;
    const bus = yield* EventBusTag;
    const maxAttempts = yield* OutboxMaxAttempts;
    const units = makeMongoUnitsOfWork(client);
    const indexed: string[] = [];

    const databaseOf = (organizationId: string) =>
      Effect.gen(function* () {
        const db = yield* resolver.forOrganization(organizationId);
        if (indexed.indexOf(db.databaseName) === -1) {
          yield* ensureOutboxIndexes(db);
          yield* ensureSpecificationIndexes(db);
          indexed.push(db.databaseName);
        }
        return db;
      });

    return {
      claimed: (organizationId, key) =>
        Effect.gen(function* () {
          const db = yield* databaseOf(organizationId);
          const replay = yield* readCommandReplay(db, key);
          if (Option.isNone(replay)) return undefined;
          const ids = asReplay(replay.value);
          if (ids === undefined) return yield* Effect.fail(unreadable());
          return { outcome: 'replayed', ...ids } satisfies ImportedRowOutcome;
        }),

      importRow: (organizationId, key, row) =>
        Effect.gen(function* () {
          const db = yield* databaseOf(organizationId);
          const { specification, offering, price } = row;
          const outcome = yield* units.forDatabase(db).run(
            unit =>
              Effect.gen(function* () {
                const { session } = unit.handle;
                const collection = (name: string) =>
                  unit.handle.db.collection(name);
                specification.code = yield* drawSpecificationCode(
                  unit.handle.db,
                  session,
                );
                specification.specKey = specification.code;
                specification.revision = 1;
                const event = yield* row.seal(specification);
                yield* store(() =>
                  collection(SPECIFICATION_COLLECTION).insertOne(
                    {
                      ...serializeEntity(ProductSpecification, specification),
                      id: specification.id,
                    },
                    { session },
                  ),
                );
                yield* store(() =>
                  collection(OFFERING_COLLECTION).insertOne(
                    {
                      ...serializeEntity(ProductOffering, offering),
                      id: offering.id,
                    },
                    { session },
                  ),
                );
                yield* store(() =>
                  collection(PRICE_COLLECTION).insertOne(
                    {
                      ...serializeEntity(ProductOfferingPrice, price),
                      id: price.id,
                    },
                    { session },
                  ),
                );
                if (event !== undefined) unit.emit(event);
                return {
                  specificationId: String(specification.id),
                  offeringId: String(offering.id),
                } satisfies RowReplay;
              }),
            {
              claim: { kind: 'command', commandId: key },
              replay: ids => ids,
              afterCommit: drainOutboxNow(db).pipe(
                Effect.provideService(EventBusTag, bus),
                Effect.provideService(OutboxMaxAttempts, maxAttempts),
              ),
            },
          );
          if (outcome._tag === 'committed')
            return { outcome: 'created', ...outcome.value } as const;
          // A unit whose body cannot abort ends `duplicate` or committed.
          const ids = asReplay(
            Option.getOrUndefined(
              (outcome as { readonly replay: Option.Option<unknown> }).replay,
            ),
          );
          if (ids === undefined) return yield* Effect.fail(unreadable());
          return { outcome: 'replayed', ...ids } as const;
        }),

      record: (organizationId, catalogImport) =>
        Effect.gen(function* () {
          const db = yield* databaseOf(organizationId);
          // Claimed under the import's own id, so two attempts racing on one
          // sheet write one record and both answer it.
          const outcome = yield* units.forDatabase(db).run(
            unit =>
              Effect.gen(function* () {
                const document = serializeEntity(CatalogImport, catalogImport);
                yield* store(() =>
                  unit.handle.db
                    .collection(CATALOG_IMPORT_COLLECTION)
                    .insertOne(
                      { ...document, id: catalogImport.id },
                      { session: unit.handle.session },
                    ),
                );
                return catalogImport;
              }),
            {
              claim: {
                kind: 'command',
                commandId: `catalog-import:${String(catalogImport.id)}`,
              },
              replay: written => serializeEntity(CatalogImport, written),
            },
          );
          if (outcome._tag === 'committed') return outcome.value;
          const replayed = Option.getOrUndefined(
            (outcome as { readonly replay: Option.Option<unknown> }).replay,
          );
          return (yield* deserializeSingleEntity(CatalogImport, replayed).pipe(
            Effect.mapError(unreadable),
          )) as CatalogImport;
        }),
    };
  }),
);
