import { ConfigurationRepositoryTag } from '@r10c/entifix-ts-business';
import { ConfigurationClientInMemory } from '@r10c/entifix-ts-core';
import { OUTBOX_COLLECTION } from '@r10c/entifix-ts-mongo-client';
import { Effect, Exit } from 'effect';
import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { rebuildTenantPublications } from './rebuild';

/**
 * ⚠️ These are the assertions a live pass cannot make cheaply and a live pass
 * is still owed for the rest.
 *
 * The walk's whole subject is a fleet of tenant databases and a broker, so what
 * is pinned here is the **decision** made per offering: which of the five
 * outcomes it lands on, and — the one that matters most — that a stored moment
 * rather than a fresh clock reading is what reaches the outbox.
 */

const SEEDED_AT = new Date('2026-01-01T00:00:00.000Z');

interface Recorded {
  readonly inserted: {
    eventId: string;
    event: { data: Record<string, unknown> };
  }[];
  readonly revived: string[];
  readonly filters: unknown[];
}

/** One offering document as the store holds it. */
const offeringDocument = (
  id: string,
  overrides: Record<string, unknown> = {},
) => ({
  id,
  name: `Offering ${id}`,
  specificationId: 'spec-1',
  status: 'published',
  statusChangedAt: SEEDED_AT,
  ...overrides,
});

interface FakeOptions {
  readonly offerings: Record<string, unknown>[];
  /** `false` makes every enqueue answer `duplicate`. */
  readonly outboxAccepts?: boolean;
  /** What `reviveQuarantined` answers. */
  readonly revives?: boolean;
  readonly prices?: Record<string, unknown>[];
  readonly specifications?: Record<string, unknown>[];
  /** Throws on the offering collection's `find`, standing in for an outage. */
  readonly readFails?: boolean;
}

const fakeDb = (options: FakeOptions) => {
  const recorded: Recorded = { inserted: [], revived: [], filters: [] };

  const documentsFor = (name: string): Record<string, unknown>[] => {
    if (name === 'product-offering') return options.offerings;
    if (name === 'product-offering-price')
      return (
        options.prices ??
        // One price per offering by default, so a test says nothing about
        // pricing unless it means to.
        options.offerings.map((offering, index) => ({
          id: `price-${index + 1}`,
          offeringId: offering['id'],
          amount: 1999,
          currency: 'GTQ',
        }))
      );
    return options.specifications ?? [{ id: 'spec-1', name: 'A widget' }];
  };

  /** Enough of a Mongo query to honour the `{ field: { $eq } }` this walk emits. */
  const matches = (
    document: Record<string, unknown>,
    filter: Record<string, unknown>,
  ): boolean =>
    Object.entries(filter).every(([field, condition]) => {
      const expected = (condition as { $eq?: unknown }).$eq;
      return document[field] === expected;
    });

  const db = {
    databaseName: 'tenant_acme',
    collection: (name: string) => {
      if (name === OUTBOX_COLLECTION) {
        return {
          createIndex: async () => undefined,
          insertOne: async (document: Recorded['inserted'][number]) => {
            if (options.outboxAccepts === false) {
              throw Object.assign(new Error('duplicate key'), { code: 11000 });
            }
            recorded.inserted.push(document);
            return { acknowledged: true };
          },
          updateOne: async (filter: { eventId: string }) => {
            recorded.revived.push(filter.eventId);
            return { modifiedCount: options.revives === true ? 1 : 0 };
          },
        };
      }

      const documents = documentsFor(name);
      return {
        find: (filter: unknown) => {
          if (name === 'product-offering') {
            if (options.readFails === true) {
              throw new Error('connection reset');
            }
            recorded.filters.push(filter);
          }
          let view = documents.filter(document =>
            matches(document, (filter ?? {}) as Record<string, unknown>),
          );
          return {
            sort: () => ({
              skip: (count: number) => {
                view = view.slice(count);
                return {
                  limit: (count: number) => ({
                    toArray: async () => view.slice(0, count),
                  }),
                };
              },
            }),
          };
        },
        countDocuments: async () => documents.length,
        findOne: async (filter: { id?: string }) =>
          documents.find(document => document['id'] === filter.id) ?? null,
      };
    },
  } as unknown as Db;

  return { db, recorded };
};

const run = (options: FakeOptions) => {
  const { db, recorded } = fakeDb(options);
  const exit = Effect.runSyncExit(
    rebuildTenantPublications(db, 'acme', 'marketplace-admin').pipe(
      Effect.provideService(
        ConfigurationRepositoryTag,
        new ConfigurationClientInMemory({}),
      ),
    ) as Effect.Effect<never, never, never>,
  );
  return { exit, recorded };
};

const reportOf = async (options: FakeOptions) => {
  const { db, recorded } = fakeDb(options);
  const report = await Effect.runPromise(
    rebuildTenantPublications(db, 'acme', 'marketplace-admin').pipe(
      Effect.provideService(
        ConfigurationRepositoryTag,
        new ConfigurationClientInMemory({}),
      ),
    ),
  );
  return { report, recorded };
};

describe('rebuildTenantPublications', () => {
  it('announces a published offering that was never announced', async () => {
    const { report, recorded } = await reportOf({
      offerings: [offeringDocument('off-1')],
    });

    expect(report.announced).toBe(1);
    expect(recorded.inserted).toHaveLength(1);
  });

  /**
   * ⚠️ The assertion the whole design rests on.
   *
   * The event id is `<offeringId>:<publishedAt>`, so re-emitting with the stored
   * moment reproduces the original announcement exactly — which is what makes a
   * second run a no-op and what keeps an older publication from overtaking a
   * genuine takedown.
   */
  it('re-emits the stored moment, never a fresh one', async () => {
    const { recorded } = await reportOf({
      offerings: [offeringDocument('off-1')],
    });

    expect(recorded.inserted[0]?.eventId).toBe(
      `off-1:${SEEDED_AT.toISOString()}`,
    );
    expect(recorded.inserted[0]?.event.data['publishedAt']).toBe(
      SEEDED_AT.toISOString(),
    );
  });

  it('asks only for the offerings that are stored published', async () => {
    const { recorded } = await reportOf({
      offerings: [offeringDocument('off-1')],
    });

    expect(recorded.filters[0]).toEqual({ status: { $eq: 'published' } });
  });

  it('attributes the record to the tenant whose database it walked', async () => {
    const { recorded } = await reportOf({
      offerings: [offeringDocument('off-1')],
    });

    expect(recorded.inserted[0]?.event.data['vendorId']).toBe('acme');
  });

  it('skips an announcement that is already on the bus', async () => {
    const { report, recorded } = await reportOf({
      offerings: [offeringDocument('off-1')],
      outboxAccepts: false,
      revives: false,
    });

    expect(report.alreadyAnnounced).toBe(1);
    expect(report.announced).toBe(0);
    expect(recorded.revived).toEqual([`off-1:${SEEDED_AT.toISOString()}`]);
  });

  it('revives one the relay had given up on', async () => {
    // The single failure ADR 0048 measured: the broker was down long enough for
    // the relay to spend its attempts, so the tenant store and the storefront
    // disagree with nothing reporting it.
    const { report } = await reportOf({
      offerings: [offeringDocument('off-1')],
      outboxAccepts: false,
      revives: true,
    });

    expect(report.revived).toBe(1);
    expect(report.alreadyAnnounced).toBe(0);
  });

  it('skips an offering carrying no moment, rather than inventing one', async () => {
    const { report, recorded } = await reportOf({
      offerings: [offeringDocument('off-1', { statusChangedAt: undefined })],
    });

    expect(report.unstamped).toBe(1);
    expect(recorded.inserted).toEqual([]);
  });

  it('reports an offering whose price is gone and moves on', async () => {
    const { report } = await reportOf({
      offerings: [offeringDocument('off-1'), offeringDocument('off-2')],
      prices: [],
    });

    expect(report.unannounceable).toBe(2);
  });

  it('reports an offering whose specification is gone and moves on', async () => {
    const { report } = await reportOf({
      offerings: [offeringDocument('off-1')],
      specifications: [],
    });

    expect(report.unannounceable).toBe(1);
    expect(report.announced).toBe(0);
  });

  it('keeps announcing the offerings behind a broken one', async () => {
    // One offering that cannot be published must cost exactly one offering.
    const { report } = await reportOf({
      offerings: [
        offeringDocument('off-1', { specificationId: 'gone' }),
        offeringDocument('off-2'),
      ],
    });

    expect(report.unannounceable).toBe(1);
    expect(report.announced).toBe(1);
  });

  it('pages rather than reading a whole tenant at once', async () => {
    const offerings = Array.from({ length: 101 }, (_, index) =>
      offeringDocument(`off-${index + 1}`),
    );

    const { report, recorded } = await reportOf({ offerings });

    // Two pages: a full one, then the short one that ends the loop.
    expect(recorded.filters).toHaveLength(2);
    expect(report.announced).toBe(101);
  });

  it('fails the tenant when the store cannot be read', async () => {
    // Not swallowed here: a driver failure belongs to the tenant, and the caller
    // is what keeps it from taking the tenants after it with it.
    const { exit } = run({ offerings: [], readFails: true });

    expect(Exit.isFailure(exit)).toBe(true);
  });
});
