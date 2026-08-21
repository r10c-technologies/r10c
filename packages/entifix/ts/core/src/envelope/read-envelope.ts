import { Effect } from 'effect';

import { EntifixBuildError } from '../base-entities/entifix-error';
import type { EntityMetadataDocument } from '../entity-definition/metadata';
import {
  deserializeEntityCollection,
  deserializeSingleEntity,
} from '../entity-definition/serializer';
import type { Entity, EntityConstructor } from '../types/Entity';
import type { EntityPage } from '../types/EntityPage';
import { envelopeEntityName } from './make-envelope';
import type {
  EntifixEnvelope,
  EntifixEnvelopeType,
  SerializedEntityPage,
} from './types';

/**
 * Structural check only — `meta.type` is validated separately so a mismatch
 * reports the expected/actual types rather than a generic "not an envelope".
 */
export function isEntifixEnvelope(body: unknown): body is EntifixEnvelope {
  if (body == null || typeof body !== 'object') {
    return false;
  }
  const meta = (body as EntifixEnvelope).meta;
  return (
    meta != null && typeof meta === 'object' && typeof meta.type === 'string'
  );
}

/**
 * Narrows an arbitrary body to an envelope of the expected `meta.type`, failing
 * with an {@link EntifixBuildError} otherwise. A wrong shape must never
 * silently deserialize into a half-populated entity.
 */
function assertEnvelope<TEntity extends Entity, TData>(
  entityConstructor: EntityConstructor<TEntity>,
  body: unknown,
  expected: EntifixEnvelopeType,
): Effect.Effect<EntifixEnvelope<TData>, EntifixBuildError> {
  const entity = envelopeEntityName(entityConstructor);

  if (!isEntifixEnvelope(body)) {
    return Effect.fail(
      new EntifixBuildError(
        `Expected an EntifixEnvelope for "${entity}" but the payload carried no meta.type`,
        undefined,
        { entity, expected, body },
      ),
    );
  }
  if (body.meta.type !== expected) {
    return Effect.fail(
      new EntifixBuildError(
        `Expected an EntifixEnvelope of type "${expected}" for "${entity}" but got "${body.meta.type}"`,
        undefined,
        { entity, expected, actual: body.meta.type },
      ),
    );
  }
  return Effect.succeed(body as EntifixEnvelope<TData>);
}

/**
 * Narrows an arbitrary body to an envelope of the expected `meta.type` without
 * requiring an entity constructor — for `command`/`transactionEvent` messages
 * whose `data` is not a serialized entity. `label` only sharpens error text.
 */
export function readEnvelope<TData>(
  body: unknown,
  expected: EntifixEnvelopeType,
  label = 'message',
): Effect.Effect<EntifixEnvelope<TData>, EntifixBuildError> {
  if (!isEntifixEnvelope(body)) {
    return Effect.fail(
      new EntifixBuildError(
        `Expected an EntifixEnvelope for "${label}" but the payload carried no meta.type`,
        undefined,
        { label, expected, body },
      ),
    );
  }
  if (body.meta.type !== expected) {
    return Effect.fail(
      new EntifixBuildError(
        `Expected an EntifixEnvelope of type "${expected}" for "${label}" but got "${body.meta.type}"`,
        undefined,
        { label, expected, actual: body.meta.type },
      ),
    );
  }
  return Effect.succeed(body as EntifixEnvelope<TData>);
}

export const readEntityEnvelope = <TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  body: unknown,
) =>
  Effect.gen(function* () {
    const envelope = yield* assertEnvelope<TEntity, unknown>(
      entityConstructor,
      body,
      'entity',
    );
    const entity = yield* deserializeSingleEntity(
      entityConstructor,
      envelope.data,
    );
    if (entity === undefined) {
      return yield* Effect.fail(
        new EntifixBuildError(
          `EntifixEnvelope for "${envelopeEntityName(
            entityConstructor,
          )}" carried no data`,
          undefined,
          { entity: envelopeEntityName(entityConstructor) },
        ),
      );
    }
    return entity;
  });

export const readEntityCollectionEnvelope = <TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  body: unknown,
) =>
  Effect.gen(function* () {
    const envelope = yield* assertEnvelope<TEntity, unknown>(
      entityConstructor,
      body,
      'entityCollection',
    );
    const items = yield* deserializeEntityCollection(
      entityConstructor,
      envelope.data,
    );
    return items as TEntity[];
  });

export const readEntityPageEnvelope = <TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  body: unknown,
) =>
  Effect.gen(function* () {
    const envelope = yield* assertEnvelope<
      TEntity,
      SerializedEntityPage<TEntity>
    >(entityConstructor, body, 'entityPage');
    const items = yield* deserializeEntityCollection(
      entityConstructor,
      envelope.data?.items,
    );
    return {
      items: items as TEntity[],
      total: envelope.data?.total ?? 0,
      request: envelope.data?.request ?? {},
    } satisfies EntityPage<TEntity>;
  });

/**
 * Reads a `$metadata` response back into its document.
 *
 * No deserialization step, and no defaulting of the members either: an envelope
 * whose `data` is missing a list would leave a form guessing whether "no
 * actions" meant "denied" or "malformed", so a broken payload fails loudly here
 * the way a half-populated entity does.
 */
export const readEntityMetadataEnvelope = <TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  body: unknown,
) =>
  Effect.gen(function* () {
    const envelope = yield* assertEnvelope<TEntity, EntityMetadataDocument>(
      entityConstructor,
      body,
      'entityMetadata',
    );
    const document = envelope.data;
    if (
      !Array.isArray(document?.actions) ||
      !Array.isArray(document?.useCases)
    ) {
      return yield* Effect.fail(
        new EntifixBuildError(
          `EntifixEnvelope for "${envelopeEntityName(
            entityConstructor,
          )}" carried no metadata document`,
          undefined,
          { entity: envelopeEntityName(entityConstructor) },
        ),
      );
    }
    return document;
  });
