import {
  EntifixConnError,
  type Entity,
  type EntityConstructor,
  type EntityMetadataDocument,
  type EntityMetadataSource,
  envelopeEntityName,
  readEntityMetadataEnvelope,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';

export interface EntityMetadataSourceOptions {
  /**
   * Where this entity's document lives, given its envelope name.
   *
   * A builder rather than the adapters' `BuildEntityRestOptions`, because the
   * two consumers resolve their base differently: the catalog goes through
   * `buildEntityBaseUrl`'s config-driven `compose` mode, while a Next shell with
   * hand-written same-origin routes has no adapters context at all. Both can
   * write one arrow function.
   */
  url: (entityName: string) => string;
}

/**
 * Fetches an entity's {@link EntityMetadataDocument} over HTTP.
 *
 * The response is permission-filtered by the service against the *verified*
 * principal, so nothing here re-checks anything: this reads what the caller was
 * told they may do. Cookies ride along by `fetch`'s same-origin default, which
 * is what carries the session on a Next shell's own `/api` route.
 */
export const makeEntityMetadataSource = ({
  url,
}: EntityMetadataSourceOptions): EntityMetadataSource => ({
  fetchMetadata: <TEntity extends Entity>(
    entityConstructor: EntityConstructor<TEntity>,
  ): Promise<EntityMetadataDocument> => {
    const name = envelopeEntityName(entityConstructor);
    return Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: () =>
            fetch(url(name), { headers: { Accept: 'application/json' } }),
          catch: error =>
            new EntifixConnError(
              `Metadata request for "${name}" failed`,
              error,
              {
                entity: name,
              },
            ),
        });

        if (!response.ok) {
          // A `404` here is deliberate on the service side and means "not
          // readable, or not hosted" — the endpoint refuses to distinguish the
          // two so it cannot be walked to enumerate the model. Either way the
          // caller has no affordances, so it is an error, not an empty document.
          return yield* Effect.fail(
            new EntifixConnError(
              `Metadata request for "${name}" failed with status ${response.status}`,
              undefined,
              { entity: name, status: response.status },
            ),
          );
        }

        const body = yield* Effect.tryPromise({
          try: () => response.json() as Promise<unknown>,
          catch: error =>
            new EntifixConnError(
              `Metadata response for "${name}" was not JSON`,
              error,
              { entity: name },
            ),
        });

        return yield* readEntityMetadataEnvelope(entityConstructor, body);
      }),
    );
  },
});
