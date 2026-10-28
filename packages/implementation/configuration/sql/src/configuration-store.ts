import {
  type EntityRepository,
  EntityRepositoryFactoryTag,
} from '@entifix/business';
import { EntifixConnError, type Entity, type EntityId } from '@entifix/core';
import { makeSqlRepository } from '@entifix/sql';
import {
  Configuration,
  type ConfigurationActor,
  ConfigurationWriteRefused,
  ConfigurationWriterTag,
  decideSecretWrite,
} from '@r10c/business-ts-configuration';
import { Effect, Layer } from 'effect';
import { SqlClient } from 'effect/sql';

/**
 * Blanks a secret's value on the way out.
 *
 * The single read-side choke point, and it sits in the repository so a
 * generic route serves it: `undefined` is dropped by the serializer, so the
 * envelope simply has no `value` for a secret row and `isSecret: true` is what
 * tells the client to render "unchanged" rather than "empty". Nothing
 * downstream has to remember to redact.
 */
const withoutSecretValues = (rows: readonly Entity[]): void => {
  for (const row of rows as Configuration[]) {
    if (row.isSecret === true) {
      row.value = undefined;
    }
  }
};

const blanking = (repository: EntityRepository): EntityRepository =>
  ({
    ...repository,
    load: request =>
      Effect.map(repository.load(request), page => {
        withoutSecretValues(page.items);
        return page;
      }),
    get: id =>
      Effect.map(repository.get(id), row => {
        withoutSecretValues([row]);
        return row;
      }),
  }) as EntityRepository;

/**
 * The repository factory over the `configuration` store: the relational
 * adapter, with every read blanking its secrets.
 */
export const ConfigurationRepositoryFactoryLayer = Layer.effect(
  EntityRepositoryFactoryTag,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return {
      for: entityConstructor =>
        Effect.succeed(blanking(makeSqlRepository(sql, entityConstructor))),
    };
  }),
);

/** The stored row behind an id, as the write rules need to see it. */
interface StoredRow {
  readonly service: string;
  readonly group_name: string;
  readonly key: string;
  readonly value: string;
  readonly is_secret: boolean;
}

const findStored = (id: EntityId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<StoredRow>`
      SELECT service, group_name, key, value, is_secret
      FROM configuration WHERE id = ${String(id)}
    `;
    return rows[0];
  });

/**
 * Appends to the append-only audit log.
 *
 * A secret's plaintext is never recorded on either side — `secret_changed`
 * says only that it moved, which is what an operator actually needs and is the
 * one thing a log of credentials must not become.
 */
const audit = (entry: {
  readonly configurationId: EntityId;
  readonly service: string;
  readonly groupName: string;
  readonly key: string;
  readonly action: 'create' | 'update' | 'delete';
  readonly oldValue?: string;
  readonly newValue?: string;
  readonly isSecret: boolean;
  readonly actor: ConfigurationActor;
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO configuration_audit ${sql.insert({
        configuration_id: String(entry.configurationId),
        service: entry.service,
        group_name: entry.groupName,
        key: entry.key,
        action: entry.action,
        old_value: entry.isSecret ? null : (entry.oldValue ?? null),
        new_value: entry.isSecret ? null : (entry.newValue ?? null),
        secret_changed:
          entry.isSecret &&
          entry.newValue !== undefined &&
          entry.newValue !== '',
        actor_id: String(entry.actor.userId),
        actor_email: entry.actor.subject,
      })}
    `;
  });

/**
 * Create or update one row, with its audit entry in the same transaction.
 *
 * The write-only rule is `decideSecretWrite`'s; the audit stamps are this
 * store's to write, from the actor, so a client cannot forge them. They are
 * ordinary members rather than `readonly` metadata because `readonly` would
 * drop them from *both* directions and the screen needs to read them.
 *
 * Answers the row as saved, its secret blanked.
 */
const saveConfiguration = (
  incoming: Configuration,
  actor: ConfigurationActor,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const stored =
      incoming.id === undefined ? undefined : yield* findStored(incoming.id);
    const newValue = incoming.value;

    const decision = decideSecretWrite(
      stored && { isSecret: stored.is_secret, value: stored.value },
      { isSecret: incoming.isSecret, value: incoming.value },
    );
    if (decision._tag === 'refuse') {
      return yield* Effect.fail(new ConfigurationWriteRefused(decision.code));
    }
    incoming.value = decision.value;
    incoming.updatedAt = new Date();
    incoming.updatedBy = actor.subject;

    const repository = makeSqlRepository(sql, Configuration);
    const saved = yield* sql.withTransaction(
      Effect.gen(function* () {
        const result = yield* repository.save(incoming);
        yield* audit({
          configurationId: result.id,
          service: result.service ?? stored?.service ?? '',
          groupName: result.groupName ?? stored?.group_name ?? '',
          key: result.key ?? stored?.key ?? '',
          action: stored === undefined ? 'create' : 'update',
          oldValue: stored?.value,
          newValue,
          isSecret: result.isSecret ?? stored?.is_secret ?? false,
          actor,
        });
        return result;
      }),
    );

    withoutSecretValues([saved]);
    return saved;
  });

/**
 * Delete one row and audit it in the same transaction. The row is read first
 * so the entry can name what was removed — after the delete there is nothing
 * left to describe it. Answers `false` when there was no such row.
 */
const deleteConfiguration = (id: EntityId, actor: ConfigurationActor) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const stored = yield* findStored(id);
    if (stored === undefined) return false;

    const repository = makeSqlRepository(sql, Configuration);
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* repository.delete(id);
        yield* audit({
          configurationId: id,
          service: stored.service,
          groupName: stored.group_name,
          key: stored.key,
          action: 'delete',
          oldValue: stored.value,
          isSecret: stored.is_secret,
          actor,
        });
      }),
    );
    return true;
  });

/** A driver failure is a store failure, whatever statement raised it. */
const asConnError = (error: unknown) =>
  new EntifixConnError('The configuration store failed', error);

/**
 * The audited {@link ConfigurationWriterTag} over the `configuration` store,
 * from the SQL client the host connected.
 */
export const ConfigurationWriterLayer = Layer.effect(
  ConfigurationWriterTag,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return {
      save: (incoming, actor) =>
        saveConfiguration(incoming, actor).pipe(
          Effect.provideService(SqlClient.SqlClient, sql),
          Effect.mapError(error =>
            error instanceof ConfigurationWriteRefused
              ? error
              : asConnError(error),
          ),
        ),
      delete: (id, actor) =>
        deleteConfiguration(id, actor).pipe(
          Effect.provideService(SqlClient.SqlClient, sql),
          Effect.mapError(asConnError),
        ),
    };
  }),
);
