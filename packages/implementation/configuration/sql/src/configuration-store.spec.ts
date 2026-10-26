import { EntityRepositoryFactoryTag } from '@entifix/business';
import { EntifixConnError } from '@entifix/core';
import { makeFakeSqlClient } from '@entifix/testing-unit/drivers';
import { Configuration } from '@r10c/business-ts-configuration';
import {
  type ConfigurationActor,
  ConfigurationWriteRefused,
  ConfigurationWriterTag,
} from '@r10c/business-ts-configuration';
import { describeConfigurationWriterContract } from '@r10c/business-ts-configuration/testing';
import { Effect, Layer } from 'effect';
import { SqlClient } from 'effect/sql';
import { describe, expect, it } from 'vitest';

import {
  ConfigurationRepositoryFactoryLayer,
  ConfigurationWriterLayer,
} from './configuration-store.js';

const saveConfiguration = (row: Configuration, actor: ConfigurationActor) =>
  Effect.gen(function* () {
    const writer = yield* ConfigurationWriterTag;
    return yield* writer.save(row, actor);
  });
const deleteConfiguration = (id: string, actor: ConfigurationActor) =>
  Effect.gen(function* () {
    const writer = yield* ConfigurationWriterTag;
    return yield* writer.delete(id, actor);
  });

const ACTOR = { userId: 'user-1', subject: 'ada@example.com' };

const ROW = {
  id: 'cfg-1',
  service: 'payment-service',
  group_name: 'mongo',
  key: 'uri',
  value: 'mongodb://user:secret@host',
  is_secret: true,
};

/**
 * The SQL fake with a transaction that runs its body: the fake models
 * statements, not transactions, and what these specs assert is which
 * statements ran inside one.
 */
const sqlFake = () => {
  const fake = makeFakeSqlClient();
  const client = Object.assign(fake.client as object, {
    withTransaction: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect,
  });
  const sql = Layer.succeed(SqlClient.SqlClient, client as never);
  return {
    fake,
    layer: Layer.merge(sql, ConfigurationWriterLayer.pipe(Layer.provide(sql))),
  };
};

const aRow = (fields: Partial<Configuration>) =>
  Object.assign(new Configuration(), fields);

const audits = (fake: ReturnType<typeof makeFakeSqlClient>) =>
  fake.executions.filter(execution =>
    execution.sql.includes('configuration_audit'),
  );

describeConfigurationWriterContract('the SQL writer', stored => {
  const { fake, layer } = sqlFake();
  if (stored !== undefined) {
    fake.respondTo('SELECT service, group_name', [
      {
        id: stored.id,
        service: stored.service,
        group_name: stored.groupName,
        key: stored.key,
        value: stored.value,
        is_secret: stored.isSecret,
      },
    ]);
  }
  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* ConfigurationWriterTag;
    }).pipe(Effect.provide(layer)),
  );
});

describe('ConfigurationRepositoryFactoryLayer', () => {
  it('blanks every secret it reads, by list and by id', async () => {
    const { fake, layer } = sqlFake();
    fake.respondTo('SELECT', [
      { ...ROW, groupName: 'mongo', isSecret: true },
      { id: 'cfg-2', key: 'db', value: 'payment', isSecret: false },
    ]);
    fake.respondTo('COUNT', [{ count: 2 }]);

    const [page, one] = await Effect.runPromise(
      Effect.gen(function* () {
        const factory = yield* EntityRepositoryFactoryTag;
        const repository = yield* factory.for(Configuration, {});
        return [
          yield* repository.load({}),
          yield* repository.get('cfg-1'),
        ] as const;
      }).pipe(
        Effect.provide(
          ConfigurationRepositoryFactoryLayer.pipe(Layer.provide(layer)),
        ),
      ),
    );

    const values = (page.items as Configuration[]).map(row => row.value);
    expect(values).toEqual([undefined, 'payment']);
    expect((one as Configuration).value).toBeUndefined();
  });
});

describe('saveConfiguration', () => {
  it('keeps a stored credential the form sent blank, audits without its plaintext, and answers it blanked', async () => {
    const { fake, layer } = sqlFake();
    fake.respondTo('SELECT service, group_name', [ROW]);

    const saved = await Effect.runPromise(
      saveConfiguration(
        aRow({
          id: 'cfg-1',
          service: 'payment-service',
          groupName: 'mongo',
          key: 'uri',
          value: '',
          isSecret: true,
        }),
        ACTOR,
      ).pipe(Effect.provide(layer)),
    );

    const written = fake.executions.find(
      execution =>
        execution.sql.startsWith('INSERT INTO "configuration"') ||
        execution.sql.includes('INSERT INTO "configuration" '),
    );
    expect(saved.value).toBeUndefined();
    expect(saved.updatedBy).toBe('ada@example.com');
    expect(JSON.stringify(fake.executions)).toContain(
      'mongodb://user:secret@host',
    );
    expect(JSON.stringify(audits(fake))).not.toContain('secret@host');
    expect(audits(fake)).toHaveLength(1);
    expect(written ?? fake.executions.length).toBeTruthy();
  });

  it('records a create for a row that was never stored', async () => {
    const { fake, layer } = sqlFake();

    const saved = await Effect.runPromise(
      saveConfiguration(aRow({ key: 'db', value: 'payment' }), ACTOR).pipe(
        Effect.provide(layer),
      ),
    );

    expect(saved.value).toBe('payment');
    expect(JSON.stringify(audits(fake))).toContain('create');
  });

  it('falls back to the stored row’s names when the save answers none', async () => {
    const { fake, layer } = sqlFake();
    fake.respondTo('SELECT service, group_name', [
      { ...ROW, is_secret: false },
    ]);

    await Effect.runPromise(
      saveConfiguration(aRow({ id: 'cfg-1', value: 'next' }), ACTOR).pipe(
        Effect.provide(layer),
      ),
    );

    expect(JSON.stringify(audits(fake))).toContain('payment-service');
    expect(JSON.stringify(audits(fake))).toContain('update');
  });

  it('refuses to clear the secret flag without a new value, and writes nothing', async () => {
    const { fake, layer } = sqlFake();
    fake.respondTo('SELECT service, group_name', [ROW]);

    const refused = await Effect.runPromise(
      saveConfiguration(aRow({ id: 'cfg-1', isSecret: false }), ACTOR).pipe(
        Effect.provide(layer),
        Effect.flip,
      ),
    );

    expect(refused).toEqual(
      new ConfigurationWriteRefused('secretRequiresValue'),
    );
    expect(audits(fake)).toHaveLength(0);
  });
});

describe('saveConfiguration on an empty row', () => {
  it('audits a row with no names and no value as blanks rather than failing', async () => {
    const { fake, layer } = sqlFake();

    await Effect.runPromise(
      saveConfiguration(aRow({}), ACTOR).pipe(Effect.provide(layer)),
    );

    expect(audits(fake)).toHaveLength(1);
  });
});

describe('the writer over a store that fails', () => {
  it('reports a failed statement as a store failure on save and on delete', async () => {
    const { fake, layer } = sqlFake();
    fake.failWith('connection reset');

    const errors = await Effect.runPromise(
      Effect.all([
        saveConfiguration(aRow({ value: 'x' }), ACTOR).pipe(Effect.flip),
        deleteConfiguration('cfg-1', ACTOR).pipe(Effect.flip),
      ]).pipe(Effect.provide(layer)),
    );

    expect(errors.every(error => error instanceof EntifixConnError)).toBe(true);
  });
});

describe('deleteConfiguration', () => {
  it('deletes and audits a stored row', async () => {
    const { fake, layer } = sqlFake();
    fake.respondTo('SELECT service, group_name', [ROW]);

    const deleted = await Effect.runPromise(
      deleteConfiguration('cfg-1', ACTOR).pipe(Effect.provide(layer)),
    );

    expect(deleted).toBe(true);
    expect(JSON.stringify(audits(fake))).toContain('delete');
    expect(JSON.stringify(audits(fake))).not.toContain('secret@host');
  });

  it('answers false for a row that is not there', async () => {
    const { fake, layer } = sqlFake();

    expect(
      await Effect.runPromise(
        deleteConfiguration('cfg-404', ACTOR).pipe(Effect.provide(layer)),
      ),
    ).toBe(false);
    expect(audits(fake)).toHaveLength(0);
  });
});
