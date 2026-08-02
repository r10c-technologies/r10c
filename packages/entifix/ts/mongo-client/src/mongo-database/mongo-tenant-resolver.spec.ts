import { EntifixConnError } from '@r10c/entifix-ts-core';
import { Effect, Exit } from 'effect';
import type { Db, MongoClient } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';

import { makeMongoTenantResolver } from './mongo-tenant-resolver.js';

const fakeClient = () => {
  const db = vi.fn((name: string) => ({ databaseName: name }) as unknown as Db);
  return { client: { db } as unknown as MongoClient, db };
};

describe('makeMongoTenantResolver', () => {
  it('derives one database per organization from a single client', async () => {
    const { client, db } = fakeClient();
    const resolver = makeMongoTenantResolver(client, 'tenant_');

    await Effect.runPromise(resolver.forOrganization('org1'));
    await Effect.runPromise(resolver.forOrganization('org2'));

    // One client, two handles — `client.db()` opens no connection, which is why
    // db-per-organization costs nothing and needs no pool arithmetic.
    expect(db).toHaveBeenNthCalledWith(1, 'tenant_org1');
    expect(db).toHaveBeenNthCalledWith(2, 'tenant_org2');
  });

  it('refuses an organization id that is not name-safe', async () => {
    const { client, db } = fakeClient();
    const resolver = makeMongoTenantResolver(client, 'tenant_');

    const exit = await Effect.runPromiseExit(
      resolver.forOrganization('../admin'),
    );

    // The id is concatenated into a database name, so an unvalidated value is a
    // path to another tenant's data. Fail before touching the driver.
    expect(Exit.isFailure(exit)).toBe(true);
    expect(db).not.toHaveBeenCalled();
  });

  it('does not echo the rejected id, which arrived unvalidated', async () => {
    const { client } = fakeClient();
    const resolver = makeMongoTenantResolver(client, 'tenant_');

    const exit = await Effect.runPromiseExit(
      resolver.forOrganization('drop me'),
    );

    const cause = Exit.isFailure(exit) ? exit.cause : undefined;
    expect(JSON.stringify(cause)).not.toContain('drop me');
  });

  it('refuses a name longer than Mongo allows', async () => {
    const { client, db } = fakeClient();
    const resolver = makeMongoTenantResolver(client, 'tenant_');

    const exit = await Effect.runPromiseExit(
      resolver.forOrganization('o'.repeat(64)),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(db).not.toHaveBeenCalled();
  });

  it('fails with a connection error the service already knows how to map', async () => {
    const { client } = fakeClient();
    const resolver = makeMongoTenantResolver(client, 'tenant_');

    const error = await Effect.runPromise(
      Effect.flip(resolver.forOrganization('bad/id')),
    );

    expect(error).toBeInstanceOf(EntifixConnError);
  });
});
