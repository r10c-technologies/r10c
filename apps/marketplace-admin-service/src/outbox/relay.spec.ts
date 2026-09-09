import type { EventBus } from '@r10c/entifix-transactions';
import { type DomainEvent } from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import type { MongoClient } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { sweepTenantOutboxes } from './relay';

const anEvent = (id: string): DomainEvent => ({
  name: 'transaction.accepted',
  id,
  source: 'marketplace-admin',
  at: '2026-01-01T00:00:00.000Z',
  correlationId: id.split(':')[0] ?? id,
  data: {},
});

describe('sweepTenantOutboxes', () => {
  /**
   * A client whose first tenant cannot have its indexes ensured.
   *
   * ⚠️ Not a hypothetical failure: `ensureOutboxIndexes` documents an
   * `IndexOptionsConflict` that recurs on **every** sweep for a database
   * predating the partial index's filter. Before the per-tenant catch, that one
   * tenant left every tenant behind it undrained forever, while the relay went
   * on looking healthy.
   */
  const clientWith = (published: string[]) =>
    ({
      db: (name: string) => {
        if (name === 'admin') {
          return {
            admin: () => ({
              listDatabases: async () => ({
                databases: [{ name: 'tenant_broken' }, { name: 'tenant_ok' }],
              }),
            }),
          };
        }

        return {
          databaseName: name,
          collection: () => ({
            createIndex: async () => {
              if (name === 'tenant_broken') {
                throw new Error('IndexOptionsConflict');
              }
            },
            find: () => ({
              sort: () => ({
                limit: () => ({
                  toArray: async () => [
                    {
                      eventId: `${name}:1`,
                      event: anEvent(`${name}:1`),
                      sent: false,
                      attempts: 0,
                      quarantined: false,
                      createdAt: '2026-01-01T00:00:00.000Z',
                    },
                  ],
                }),
              }),
            }),
            updateOne: async () => {
              published.push(`${name}:sent`);
              return { modifiedCount: 1 };
            },
            countDocuments: async () => 0,
            findOne: async () => null,
          }),
        };
      },
    }) as unknown as MongoClient;

  it('keeps draining the tenants behind one that fails', async () => {
    const published: string[] = [];
    const client = clientWith(published);

    await Effect.runPromise(
      sweepTenantOutboxes(
        client,
        { publish: () => Effect.void } as unknown as EventBus,
        { prefix: 'tenant_', maxAttempts: 5 },
      ),
    );

    expect(published).toEqual(['tenant_ok:sent']);
  });
});
