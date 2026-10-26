import { EntifixConnError } from '@entifix/core';
import { makeFakeSqlClient } from '@entifix/testing-unit/drivers';
import { ConfigurationLookupTag } from '@r10c/business-ts-configuration';
import {
  CONTRACT_SERVICE,
  describeConfigurationLookupContract,
} from '@r10c/business-ts-configuration/testing';
import { Effect, Layer } from 'effect';
import { SqlClient } from 'effect/sql';
import { describe, expect, it } from 'vitest';

import { ConfigurationLookupLayer } from './configuration-lookup.js';

const lookupOver = (fake: ReturnType<typeof makeFakeSqlClient>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* ConfigurationLookupTag;
    }).pipe(
      Effect.provide(
        ConfigurationLookupLayer.pipe(
          Layer.provide(Layer.succeed(SqlClient.SqlClient, fake.client as never)),
        ),
      ),
    ),
  );

describeConfigurationLookupContract('the SQL lookup', rows => {
  const fake = makeFakeSqlClient();
  fake.respondTo(
    'WHERE service',
    rows
      .filter(row => row.service === CONTRACT_SERVICE)
      .map(row => ({
        group_name: row.groupName,
        key: row.key,
        value: row.value,
        is_secret: row.isSecret,
      })),
  );
  fake.respondTo('COUNT', [{ count: rows.length }]);
  fake.respondTo(
    'DISTINCT service',
    Array.from(new Set(rows.map(row => row.service)))
      .sort()
      .map(service => ({ service })),
  );
  return lookupOver(fake);
});

describe('the SQL lookup beyond the contract', () => {
  it('asks for the one service it was given', async () => {
    const fake = makeFakeSqlClient();

    await Effect.runPromise((await lookupOver(fake)).forService('order-service'));

    expect(fake.lastExecution?.params).toEqual(['order-service']);
  });

  it('counts an empty answer as no rows', async () => {
    const fake = makeFakeSqlClient();

    expect(await Effect.runPromise((await lookupOver(fake)).stats())).toEqual({
      rowCount: 0,
      services: [],
    });
  });

  it('reports a store it could not read as a store failure', async () => {
    const fake = makeFakeSqlClient();
    fake.failWith('connection reset');
    const lookup = await lookupOver(fake);

    const errors = await Effect.runPromise(
      Effect.all([
        Effect.flip(lookup.forService(CONTRACT_SERVICE)),
        Effect.flip(lookup.stats()),
      ]),
    );

    expect(errors.every(error => error instanceof EntifixConnError)).toBe(true);
  });
});
