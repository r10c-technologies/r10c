import {
  makeCommandEnvelope,
  readTransactionEventEnvelope,
  type TransactionCommand,
} from '@r10c/entifix-transactions';
import { ConfigurationRepositoryTag } from '@r10c/entifix-ts-business';
import {
  Entity,
  EntityConstructor,
  extractMetaEntity,
  makeEntityEnvelope,
  readEntityEnvelope,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';

import { performHttpRequestThroughFetch } from '../../../clients/fetch';
import { buildEntityRestAdapterMixins as adapterMixins } from '../build-entity-rest-adapter-mixins';
import { BuildEntityRestOptions } from '../types';

/**
 * Persists an entity over HTTP.
 *
 * An entity without an id has never been stored, so it is created with `POST`
 * against the collection; one with an id is replaced with `PUT` against its own
 * URL.
 *
 * For a plain create the response envelope — not the request — is what gets
 * deserialized and returned, because the service is the authority on the stored
 * entity (it assigns ids and may normalize fields).
 *
 * A **transactional** create inverts that, and deliberately. The service answers
 * `202` describing a transaction rather than an entity, so there is no stored
 * entity to read back yet: the client mints the transaction id, which *is* the
 * id the entity will be stored under, and returns the entity it already holds.
 * That is the point of the client owning the id (ADR 0028) — before it, this
 * adapter parsed the `202` as an entity envelope, failed, and reported an error
 * for a create that was in fact about to succeed.
 */
export const buildEntityRestAdapterSave =
  <TEntity extends Entity>(
    entityConstructor: EntityConstructor<TEntity>,
    { uriConfig, create = 'entity' }: BuildEntityRestOptions,
  ) =>
  // Deliberately not shadowing `TEntity` here (as the read builders do): the
  // envelope has to be built against the *constructor's* entity type, which a
  // shadowed parameter would make unreachable.
  <TInput extends Entity>(entity: TInput) =>
    Effect.gen(function* () {
      const configurationStore = yield* ConfigurationRepositoryTag;
      const metaEntity = extractMetaEntity(entityConstructor);
      const key = metaEntity.key ?? metaEntity.name;
      const isCreate = entity.id == null;

      const url = yield* adapterMixins.buildEntityBaseUrl(
        configurationStore,
        { uriConfig },
        key,
        isCreate ? undefined : String(entity.id),
      );

      if (isCreate && create === 'command') {
        // `crypto.randomUUID` is available in every browser this ships to and in
        // Node — and the id must be a UUID, because the service constrains the
        // key space a caller may address.
        const transactionId = crypto.randomUUID();
        entity.id = transactionId;

        const command: TransactionCommand = {
          transactionId,
          type: 'create',
          entity: key,
          payload: serializeEntity(
            entityConstructor,
            entity as unknown as TEntity,
          ),
        };

        const accepted = yield* performHttpRequestThroughFetch(
          adapterMixins.buildEntityRequest({
            method: 'POST',
            url,
            envelope: makeCommandEnvelope(command),
          }),
        );
        // Read for its shape, not its contents: this asserts the service really
        // accepted a transaction rather than answering something else with a
        // 2xx, which is the failure the old code path could not distinguish.
        yield* readTransactionEventEnvelope(accepted.body);

        return entity;
      }

      const httpRequest = adapterMixins.buildEntityRequest({
        method: isCreate ? 'POST' : 'PUT',
        url,
        envelope: makeEntityEnvelope(
          entityConstructor,
          entity as unknown as TEntity,
        ),
      });

      const response = yield* performHttpRequestThroughFetch(httpRequest);
      const saved = yield* readEntityEnvelope(entityConstructor, response.body);

      return saved as unknown as TInput;
    });
