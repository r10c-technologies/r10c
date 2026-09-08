import {
  CATALOG_PUBLISHED,
  CATALOG_UNPUBLISHED,
  type CatalogPublication,
} from '@r10c/business-ts-catalog-contracts';
import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { describeEntityColumns } from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { applyPublication, catalogSubscription } from './publish-catalog.js';

/**
 * ⚠️ The guard these tests exist for is an **ordering** guard, not a
 * deduplication one.
 *
 * The register calls this subscription `dedupe: 'natural'`, and the usual
 * argument for that is "the projection is a full-document upsert keyed on the
 * offering id, so re-applying one publication writes the same document". That
 * is true for a publish and false for an unpublish, which deletes: at
 * least-once delivery can land a redelivered `catalog.unpublished` after a
 * newer `catalog.published`, removing a listing that is legitimately live —
 * permanently, silently, and with every probe still green. Comparing the
 * event's own `publishedAt` against the stored record is what makes the
 * register's claim true rather than merely written down.
 */

const PUBLICATION: CatalogPublication = {
  offeringId: 'offering-1',
  vendorId: 'org-1',
  name: 'A hand-thrown mug',
  amount: 24_900,
  currency: 'GTQ',
  availableHint: true,
  publishedAt: '2026-09-07T10:00:00.000Z',
  code: 'product-013',
  description: 'Stoneware, glazed by hand.',
  brandId: 'product-brand-3',
  categoryId: 'product-category-7',
};

type Call = { readonly op: 'replace' | 'delete'; readonly document?: unknown };

/**
 * An in-memory stand-in for the two collections the projector touches, keyed by
 * `offeringId` — the record store and its tombstones.
 *
 * Stateful rather than a pair of stubs, because the defect this file exists to
 * pin is a *sequence*: a delete followed by an older publication. Fixed answers
 * cannot express the second write seeing what the first one left.
 */
const projection = (seed?: {
  record?: Record<string, unknown>;
  tombstone?: Record<string, unknown>;
}) => {
  const store = new Map<string, Record<string, unknown> | undefined>([
    ['records', seed?.record],
    ['tombstones', seed?.tombstone],
  ]);
  const calls: Call[] = [];

  const collectionFor = (name: string) => ({
    findOne: () => Promise.resolve(store.get(name) ?? null),
    replaceOne: (_filter: unknown, document: Record<string, unknown>) => {
      store.set(name, document);
      if (name === 'records') calls.push({ op: 'replace', document });
      return Promise.resolve({ acknowledged: true });
    },
    deleteOne: () => {
      store.set(name, undefined);
      if (name === 'records') calls.push({ op: 'delete' });
      return Promise.resolve({ acknowledged: true });
    },
  });

  const db = {
    collection: (name: string) =>
      collectionFor(name.endsWith('-tombstone') ? 'tombstones' : 'records'),
  } as unknown as Db;

  return {
    db,
    calls,
    get record() {
      return store.get('records');
    },
    get tombstone() {
      return store.get('tombstones');
    },
  };
};

/** The common case: a projection holding one record and no tombstone. */
const dbHolding = (stored?: Record<string, unknown>) => {
  const p = projection({ record: stored });
  return { db: p.db, calls: p.calls };
};

const apply = (
  db: Db,
  eventName: string,
  publication: CatalogPublication = PUBLICATION,
) => Effect.runPromise(applyPublication(db, eventName, publication));

describe('the subscription this slice binds', () => {
  it('binds one pattern covering both names, so they share an order', () => {
    // Two subscriptions would be two queues delivering independently, which is
    // exactly how a redelivered unpublication overtakes the publication that
    // superseded it. One queue, one order.
    expect(catalogSubscription.pattern).toBe('catalog.*');
  });

  it('names the subscribing slice, never the emitter', () => {
    // `queueNameFor` files the durable queue under this. One deployment hosts
    // several slices, so the publisher's name would file this consumer's
    // backlog under whoever shares its process.
    expect(catalogSubscription.slice).toBe('marketplace');
  });

  it('takes a durable work queue, because a lost message is an invisible gap', () => {
    // The projection is this slice's system of record for the published
    // catalog. A broadcast queue is anonymous and dies with its connection, so
    // anything published while the service restarts would be dropped by the
    // broker while the outbox had already recorded it sent.
    expect(catalogSubscription.mode).toBe('work');
  });

  it('pins the delivery ceiling as a literal', () => {
    // `x-delivery-limit` is immutable once the queue exists — re-declaring with
    // a different value fails `PRECONDITION_FAILED` and closes the channel — so
    // this number matches the register's and changing it means deleting the
    // queue.
    expect(catalogSubscription.maxAttempts).toBe(5);
  });
});

describe('applying a publication', () => {
  it('writes the snapshot into an empty projection', async () => {
    const { db, calls } = dbHolding();

    await apply(db, CATALOG_PUBLISHED);

    expect(calls).toEqual([
      {
        op: 'replace',
        document: {
          id: 'offering-1',
          offeringId: 'offering-1',
          vendorId: 'org-1',
          name: 'A hand-thrown mug',
          amount: 24_900,
          currency: 'GTQ',
          availableHint: true,
          publishedAt: new Date('2026-09-07T10:00:00.000Z'),
          code: 'product-013',
          description: 'Stoneware, glazed by hand.',
          brandId: 'product-brand-3',
          categoryId: 'product-category-7',
        },
      },
    ]);
  });

  it('keys the record on the offering, so republishing replaces rather than accumulates', async () => {
    const { db, calls } = dbHolding({
      offeringId: 'offering-1',
      publishedAt: new Date('2026-09-07T09:00:00.000Z'),
    });

    await apply(db, CATALOG_PUBLISHED);

    expect(calls).toHaveLength(1);
    expect((calls[0].document as { id: string }).id).toBe('offering-1');
  });

  it('replaces wholesale, carrying no member of the record it overwrites', async () => {
    // ADR 0009: derived data with a partial update path drifts from its source
    // in ways nothing detects. A corrected name must not leave the old one, and
    // a member the publisher stopped sending must not survive.
    const { db, calls } = dbHolding({
      offeringId: 'offering-1',
      name: 'The old name',
      legacyMember: 'should not survive',
      publishedAt: new Date('2026-09-07T09:00:00.000Z'),
    });

    await apply(db, CATALOG_PUBLISHED, {
      ...PUBLICATION,
      name: 'The corrected name',
    });

    const document = calls[0].document as Record<string, unknown>;
    expect(document['name']).toBe('The corrected name');
    expect(document).not.toHaveProperty('legacyMember');
  });

  it('removes the record on an unpublication', async () => {
    const { db, calls } = dbHolding({
      offeringId: 'offering-1',
      publishedAt: new Date('2026-09-07T09:00:00.000Z'),
    });

    await apply(db, CATALOG_UNPUBLISHED);

    expect(calls).toEqual([{ op: 'delete' }]);
  });

  it('removes a record it cannot find, which is what a redelivery looks like', async () => {
    // Deleting nothing is the correct outcome and must not fail: the message
    // would be requeued, counted against `x-delivery-limit`, and eventually
    // quarantined for having succeeded.
    const { db, calls } = dbHolding();

    await apply(db, CATALOG_UNPUBLISHED);

    expect(calls).toEqual([{ op: 'delete' }]);
  });

  it('reports a driver failure rather than swallowing it', async () => {
    // A handler failure is transient: the adapter requeues and the broker counts
    // the redelivery. Swallowing it would acknowledge a message the projection
    // never took.
    const db = {
      collection: () => ({
        findOne: () => Promise.reject(new Error('replica set unreachable')),
      }),
    } as unknown as Db;

    await expect(apply(db, CATALOG_PUBLISHED)).rejects.toThrow();
  });
});

describe('the ordering guard', () => {
  it('applies a publication newer than the stored record', async () => {
    const { db, calls } = dbHolding({
      offeringId: 'offering-1',
      publishedAt: new Date('2026-09-07T09:00:00.000Z'),
    });

    await apply(db, CATALOG_PUBLISHED);

    expect(calls).toHaveLength(1);
  });

  it('ignores a publication older than the stored record', async () => {
    const { db, calls } = dbHolding({
      offeringId: 'offering-1',
      publishedAt: new Date('2026-09-07T11:00:00.000Z'),
    });

    await apply(db, CATALOG_PUBLISHED);

    expect(calls).toEqual([]);
  });

  /**
   * ⚠️ The failure this whole guard exists for.
   *
   * Publish at 10:00, unpublish at 10:30, republish at 11:00 — then the 10:30
   * unpublication is redelivered. Without the comparison it deletes a listing
   * the vendor put back, and nothing anywhere reports a problem.
   */
  it('ignores a stale unpublication that would delete a live listing', async () => {
    const { db, calls } = dbHolding({
      offeringId: 'offering-1',
      publishedAt: new Date('2026-09-07T11:00:00.000Z'),
    });

    await apply(db, CATALOG_UNPUBLISHED, {
      ...PUBLICATION,
      publishedAt: '2026-09-07T10:30:00.000Z',
    });

    expect(calls).toEqual([]);
  });

  it('re-applies an exact redelivery, because equal is not older', async () => {
    // Re-applying the same publication writes the same document, which is the
    // idempotence the register's `natural` claim rests on. Treating equal as
    // stale would instead drop the *first* delivery whenever a record already
    // carried that moment.
    const { db, calls } = dbHolding({
      offeringId: 'offering-1',
      publishedAt: new Date(PUBLICATION.publishedAt),
    });

    await apply(db, CATALOG_PUBLISHED);

    expect(calls).toHaveLength(1);
  });

  it('lets any publication supersede a record with no moment at all', async () => {
    // A document written before `publishedAt` existed. The epoch, so every real
    // publication wins — the opposite default would freeze such a record
    // permanently, and it would be invisible.
    const { db, calls } = dbHolding({ offeringId: 'offering-1' });

    await apply(db, CATALOG_PUBLISHED);

    expect(calls).toHaveLength(1);
  });

  it('treats a non-date moment as no moment rather than trusting it', async () => {
    // A hand-edited or half-migrated document. Comparing against a string would
    // produce `NaN` and make every comparison false, which reads as "always
    // stale" and freezes the record.
    const { db, calls } = dbHolding({
      offeringId: 'offering-1',
      publishedAt: '2026-09-07T11:00:00.000Z',
    });

    await apply(db, CATALOG_PUBLISHED);

    expect(calls).toHaveLength(1);
  });
});

describe('the tombstone, and the race it exists for', () => {
  const publishedAt = (iso: string) => ({ ...PUBLICATION, publishedAt: iso });

  /**
   * ⚠️ Measured against the running fleet, not imagined.
   *
   * Publishing and unpublishing an offering 19ms apart raced two inline outbox
   * drains: the unpublication was delivered first, its delete found nothing and
   * left nothing behind, and the older publication that followed looked exactly
   * like a first publication. The storefront went on showing an offering whose
   * tenant-side record said `unpublished` — the failure this projector's guard
   * was written to prevent, arriving by the one route the guard did not cover.
   */
  it('does not resurrect an offering when an older publication arrives after the delete', async () => {
    const p = projection();

    await Effect.runPromise(
      applyPublication(
        p.db,
        CATALOG_UNPUBLISHED,
        publishedAt('2026-09-07T10:00:01.000Z'),
      ),
    );
    await Effect.runPromise(
      applyPublication(
        p.db,
        CATALOG_PUBLISHED,
        publishedAt('2026-09-07T10:00:00.000Z'),
      ),
    );

    expect(p.record).toBeUndefined();
  });

  it('leaves a tombstone carrying the moment the offering came down', async () => {
    const p = projection({ record: { offeringId: 'offering-1' } });

    await Effect.runPromise(
      applyPublication(p.db, CATALOG_UNPUBLISHED, PUBLICATION),
    );

    expect(p.tombstone).toEqual({
      offeringId: 'offering-1',
      publishedAt: new Date(PUBLICATION.publishedAt),
    });
  });

  it('still lets a genuinely newer publication bring the offering back', async () => {
    // The guard must order, not freeze: a vendor who unpublishes and then
    // changes their mind has to reach the storefront again.
    const p = projection();

    await Effect.runPromise(
      applyPublication(
        p.db,
        CATALOG_UNPUBLISHED,
        publishedAt('2026-09-07T10:00:00.000Z'),
      ),
    );
    await Effect.runPromise(
      applyPublication(
        p.db,
        CATALOG_PUBLISHED,
        publishedAt('2026-09-07T11:00:00.000Z'),
      ),
    );

    expect(p.record).toMatchObject({ offeringId: 'offering-1' });
  });

  it('clears the tombstone once a publication supersedes it', async () => {
    // Left in place it would go on ordering against a stale moment, and the
    // next unpublication would compare against the wrong one.
    const p = projection();

    await Effect.runPromise(
      applyPublication(
        p.db,
        CATALOG_UNPUBLISHED,
        publishedAt('2026-09-07T10:00:00.000Z'),
      ),
    );
    await Effect.runPromise(
      applyPublication(
        p.db,
        CATALOG_PUBLISHED,
        publishedAt('2026-09-07T11:00:00.000Z'),
      ),
    );

    expect(p.tombstone).toBeUndefined();
  });

  it('ignores an unpublication older than the tombstone already there', async () => {
    // Two redeliveries of two different unpublications must not walk the
    // ordering key backwards.
    const p = projection({
      tombstone: {
        offeringId: 'offering-1',
        publishedAt: new Date('2026-09-07T12:00:00.000Z'),
      },
    });

    await Effect.runPromise(
      applyPublication(
        p.db,
        CATALOG_UNPUBLISHED,
        publishedAt('2026-09-07T10:00:00.000Z'),
      ),
    );

    expect(p.tombstone).toMatchObject({
      publishedAt: new Date('2026-09-07T12:00:00.000Z'),
    });
  });

  it('writes the tombstone before removing the record', async () => {
    // Between the two writes the offering must never look publishable again. A
    // delete that lands with no marker behind it is the resurrection above.
    const order: string[] = [];
    const db = {
      collection: (name: string) => ({
        findOne: () => Promise.resolve(null),
        replaceOne: () => {
          order.push(
            `replace:${name.endsWith('-tombstone') ? 'tombstone' : 'record'}`,
          );
          return Promise.resolve({ acknowledged: true });
        },
        deleteOne: () => {
          order.push(
            `delete:${name.endsWith('-tombstone') ? 'tombstone' : 'record'}`,
          );
          return Promise.resolve({ acknowledged: true });
        },
      }),
    } as unknown as Db;

    await Effect.runPromise(
      applyPublication(db, CATALOG_UNPUBLISHED, PUBLICATION),
    );

    expect(order).toEqual(['replace:tombstone', 'delete:record']);
  });
});

describe('the payload and the record it is written into', () => {
  it('holds a member for every member of the publication', () => {
    // ⚠️ This is the pin that makes one shared contract worth having.
    //
    // `CatalogPublication` is authored by `product-configuration-management`
    // and projected into `marketplace-catalog`, and those two packages may not
    // import each other — only the `business:policy` contract sits where both
    // can reach it. This service is the one place that legitimately depends on
    // both, so it is the one place the mapping can be asserted at all.
    //
    // A member added to the payload with no home on the entity is a field the
    // projector silently never writes, which reads on the storefront as data
    // that simply never arrived.
    const columns = describeEntityColumns(PublishedOffering).map(
      column => column.name,
    );

    const publication: Record<keyof CatalogPublication, true> = {
      offeringId: true,
      vendorId: true,
      name: true,
      amount: true,
      currency: true,
      availableHint: true,
      publishedAt: true,
      code: true,
      description: true,
      brandId: true,
      categoryId: true,
    };

    for (const member of Object.keys(publication)) {
      expect(
        columns,
        `CatalogPublication carries '${member}' and PublishedOffering has ` +
          'nowhere to put it, so the projector would drop it silently.',
      ).toContain(member);
    }
  });

  it('writes a key for every member the publication carried', async () => {
    // ⚠️ The half the pin above cannot see. A home on the entity is not a write:
    // the document goes out through `serializeEntity`, which skips any accessor
    // marked `hidden` or `readonly`, so either flag on a snapshot member would
    // stop projecting it while the mapping assertion above still passed and the
    // storefront quietly lost a field.
    const { db, calls } = dbHolding();

    await apply(db, CATALOG_PUBLISHED);

    const document = calls[0]?.document as Record<string, unknown>;

    for (const member of Object.keys(PUBLICATION)) {
      expect(
        document,
        `the publication carried '${member}' and the projected document does ` +
          'not, so the storefront never receives it.',
      ).toHaveProperty(member);
    }
  });

  it('omits an absent optional rather than storing null', async () => {
    // A specification legitimately carries no description, no brand and no
    // category. `null` in the projection is not the same as absent: it renders
    // as an empty label rather than as nothing, and it is what BSON writes for
    // an assigned `undefined`.
    const { db, calls } = dbHolding();

    await apply(db, CATALOG_PUBLISHED, {
      ...PUBLICATION,
      code: undefined,
      description: undefined,
      brandId: undefined,
      categoryId: undefined,
    });

    const document = calls[0]?.document as Record<string, unknown>;

    expect(Object.keys(document)).not.toContain('description');
    expect(Object.keys(document)).not.toContain('brandId');
    expect(Object.keys(document)).not.toContain('categoryId');
    expect(Object.keys(document)).not.toContain('code');
  });

  it('drops a description the vendor cleared, because the record is replaced', async () => {
    // Wholesale replacement, never a merge (ADR 0009). A partial update path
    // would leave the old description behind and the projection would disagree
    // with its source in a way nothing detects.
    const { db, calls } = dbHolding({
      offeringId: 'offering-1',
      publishedAt: new Date('2026-09-07T09:00:00.000Z'),
      description: 'The description that was published first.',
    });

    await apply(db, CATALOG_PUBLISHED, {
      ...PUBLICATION,
      description: undefined,
    });

    const document = calls.at(-1)?.document as Record<string, unknown>;

    expect(Object.keys(document)).not.toContain('description');
  });
});
