import {
  EntityIdTag,
  EntityLoadRequestTag,
  EntityRepositoryTag,
  getUCFactory,
  loadUCFactory,
} from '@r10c/entifix-ts-business';
import {
  type EntifixEnvelopeLink,
  type Entity,
  type EntityConstructor,
  type EntityId,
  type EntityLoadRequest,
  envelopeEntityName,
  makeEntityEnvelope,
  makeEntityPageEnvelope,
  parseLoadRequestParams,
} from '@r10c/entifix-ts-core';
import { makeMongoRepository } from '@r10c/entifix-ts-mongo-client';
import { stubConfigurationLayer } from '@r10c/entifix-ts-testing-unit';
import {
  type FakeMongoDb,
  makeFakeMongoDb,
} from '@r10c/entifix-ts-testing-unit/drivers';
import { Effect } from 'effect';

/**
 * A response as an HTTP transport would send it. `body` is an entifix envelope
 * or an error record; it stays `unknown` here so the backend is not coupled to
 * one transport's body type.
 */
export interface BackendResponse {
  readonly status: number;
  readonly body: unknown;
}

/** Rows as they are stored — the entity wire shape, exactly like the seed. */
export type BackendRow = Record<string, unknown>;

export interface EntityBackendOptions {
  /** Initial documents, in the entity wire shape. */
  seed?: ReadonlyArray<BackendRow>;
}

export interface EntityBackend {
  /** The entity `key` — collection name and REST path segment alike. */
  readonly key: string;
  /** `GET /api/<key>?<search>` — filtering, sorting and paging included. */
  list(search: URLSearchParams): Promise<BackendResponse>;
  /** `GET /api/<key>/:id`. */
  get(id: EntityId): Promise<BackendResponse>;
  /** Replaces the stored rows, so one fixture can serve several journeys. */
  seed(rows: ReadonlyArray<BackendRow>): void;
  /** The rows currently stored, for assertions about what a write did. */
  rows(): BackendRow[];
  /** The underlying driver fake, for failure injection. */
  readonly db: FakeMongoDb;
}

const collectionLinks = (key: string): EntifixEnvelopeLink[] => [
  { rel: 'self', href: `/api/${key}`, method: 'GET' },
  { rel: 'create', href: `/api/${key}`, method: 'POST' },
];

const entityLinks = (key: string, id: EntityId): EntifixEnvelopeLink[] => [
  { rel: 'self', href: `/api/${key}/${String(id)}`, method: 'GET' },
  { rel: 'list', href: `/api/${key}`, method: 'GET' },
  { rel: 'update', href: `/api/${key}/${String(id)}`, method: 'PUT' },
  { rel: 'delete', href: `/api/${key}/${String(id)}`, method: 'DELETE' },
];

/**
 * A read backend for one entity, assembled from the PRODUCTION query pipeline:
 *
 * ```
 * parseLoadRequestParams  →  loadUCFactory  →  makeMongoRepository  →  fake driver
 *   (core: RSQL + the         (business:        (mongo-client:          (testing-unit)
 *    filterable/sortable       the use-case)     filter translation)
 *    allowlist)
 * ```
 *
 * Nothing here re-implements query semantics. That is the whole point: a mock
 * backend that answers a filter with "all the rows" makes a green `mock` run
 * meaningless, and a mock backend that implements its *own* RSQL makes the two
 * profiles disagree the first time an operator is added. Because the real
 * pipeline runs, `mock` and `live` agree on filtering, sorting, paging, and on
 * the `400 invalid query` the metadata allowlist produces.
 *
 * Writes are deliberately absent: a `POST` in the admin service is a
 * *transaction* answering `202`, and a fixture that answered `201` instead
 * would be a lie about the protocol rather than a stand-in for it.
 */
export const makeEntityBackend = <TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  { seed = [] }: EntityBackendOptions = {},
): EntityBackend => {
  const key = envelopeEntityName(entityConstructor);
  const db = makeFakeMongoDb({ [key]: seed.map(row => ({ ...row })) });
  const repository = makeMongoRepository(
    // The driver fake is typed `unknown` so `testing-unit` need not depend on
    // the mongodb types; the cast is the documented way to hand it over.
    db.db as Parameters<typeof makeMongoRepository>[0],
    entityConstructor,
  );

  /** Both use-cases need a configuration store in their requirement channel. */
  const run = <TValue, TError>(
    effect: Effect.Effect<TValue, TError, never>,
  ): Promise<TValue> => Effect.runPromise(effect);

  const provided = <TValue, TError, TContext>(
    effect: Effect.Effect<TValue, TError, TContext>,
  ) => Effect.provide(effect, stubConfigurationLayer());

  return {
    key,

    list: async search => {
      let request: EntityLoadRequest;
      try {
        request = parseLoadRequestParams(
          entityConstructor,
          search,
        ) as unknown as EntityLoadRequest;
      } catch (error) {
        // The same 400 the service answers: an unparseable expression, or a
        // member the entity never declared filterable/sortable. The codec only
        // ever throws `EntifixBuildError` here, so there is no second case to
        // discriminate — anything else would be a bug in the codec, and
        // reporting it verbatim is more useful than hiding it behind a 500.
        return {
          status: 400,
          body: { error: 'invalid query', detail: String(error) },
        };
      }

      try {
        const page = await run(
          provided(
            loadUCFactory<TEntity>().pipe(
              Effect.provideService(EntityRepositoryTag, repository),
              Effect.provideService(EntityLoadRequestTag, request),
            ),
          ),
        );

        return {
          status: 200,
          body: makeEntityPageEnvelope(
            entityConstructor,
            page,
            collectionLinks(key),
          ),
        };
      } catch (error) {
        // A repository that fails is a 500, exactly as in the service: the
        // request was valid, the store was not reachable.
        return {
          status: 500,
          body: { error: 'request failed', detail: String(error) },
        };
      }
    },

    get: async id => {
      const entity = await run(
        provided(
          getUCFactory<TEntity>().pipe(
            Effect.provideService(EntityRepositoryTag, repository),
            Effect.provideService(EntityIdTag, id),
          ),
        ).pipe(Effect.option),
      );

      return entity._tag === 'None'
        ? { status: 404, body: { message: `${key} not found` } }
        : {
            status: 200,
            body: makeEntityEnvelope(
              entityConstructor,
              entity.value,
              entityLinks(key, id),
            ),
          };
    },

    seed: rows => {
      db.seed(
        key,
        rows.map(row => ({ ...row })),
      );
    },

    rows: () => db.read(key),

    db,
  };
};
