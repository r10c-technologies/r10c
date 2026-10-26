import { describeEntityColumns } from '@entifix/core';
import { MongoDatabaseTag } from '@entifix/mongo';
import {
  makeMongoUnitOfWork,
  MongoUnitOfWorkTag,
} from '@entifix/mongo/transactions';
import { makeFakeMongoDb } from '@entifix/testing-unit/drivers';
import {
  CATALOG_PUBLISHED,
  CATALOG_UNPUBLISHED,
  type CatalogPublication,
} from '@r10c/business-ts-catalog-contracts';
import {
  PublishedCatalogTag,
  PublishedOffering,
} from '@r10c/business-ts-marketplace-catalog';
import { describePublishedCatalogContract } from '@r10c/business-ts-marketplace-catalog/testing';
import { Effect, Layer } from 'effect';
import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import {
  MongoPublishedCatalogLayer,
  PROJECTION_COLLECTION,
  STAMP_COLLECTION,
} from './published-catalog.js';

/**
 * ⚠️ The guard these tests exist for is an **ordering** guard, not a
 * deduplication one. At-least-once delivery can land a redelivered
 * `catalog.unpublished` after a newer `catalog.published`, removing a listing
 * that is legitimately live — permanently, silently, with every probe green.
 *
 * What these cannot prove is the concurrent half: the fake runs one
 * transaction at a time, so two applies never conflict here. That is proven
 * against the live lab by a parallel burst (ADR 0063, #357).
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
  media: [{ url: 'https://cdn.example/mug.jpg', alt: 'The mug, glazed blue' }],
};

type Seed = Record<string, Record<string, unknown>[]>;

const world = (seed: Seed = {}) => {
  const fake = makeFakeMongoDb(seed);
  const layer = MongoPublishedCatalogLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(MongoDatabaseTag, fake.db as Db),
        Layer.succeed(
          MongoUnitOfWorkTag,
          makeMongoUnitOfWork({ client: fake as never, db: fake.db as Db }),
        ),
      ),
    ),
  );
  const apply = (
    eventName: string,
    publication: Partial<CatalogPublication> = {},
  ) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const catalog = yield* PublishedCatalogTag;
        return yield* catalog.apply(eventName, {
          ...PUBLICATION,
          ...publication,
        });
      }).pipe(Effect.provide(layer)),
    );
  return {
    fake,
    apply,
    get record() {
      return fake.read(PROJECTION_COLLECTION)[0];
    },
    get stamp() {
      return fake.read(STAMP_COLLECTION)[0];
    },
  };
};

const stampAt = (iso: unknown) => ({
  [STAMP_COLLECTION]: [{ offeringId: 'offering-1', publishedAt: iso }],
});

const at = (iso: string) => ({ publishedAt: iso });

describePublishedCatalogContract('the Mongo projection', async () => {
  const { fake } = world();
  const db = fake.db as Db;
  const catalog = await Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        return yield* PublishedCatalogTag;
      }),
      MongoPublishedCatalogLayer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(MongoDatabaseTag, db),
            Layer.succeed(
              MongoUnitOfWorkTag,
              makeMongoUnitOfWork({ client: fake as never, db }),
            ),
          ),
        ),
      ),
    ),
  );
  return {
    catalog,
    isListed: offeringId =>
      Promise.resolve(
        fake
          .read(PROJECTION_COLLECTION)
          .some(record => record['offeringId'] === offeringId),
      ),
  };
});

describe('applying a publication', () => {
  it('writes the snapshot into an empty projection', async () => {
    const p = world();

    expect(await p.apply(CATALOG_PUBLISHED)).toBe('applied');
    expect(p.record).toMatchObject({
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
      media: [
        { url: 'https://cdn.example/mug.jpg', alt: 'The mug, glazed blue' },
      ],
    });
  });

  it('replaces wholesale, so republishing leaves one record carrying none of the old', async () => {
    // ADR 0009: derived data with a partial update path drifts from its source
    // in ways nothing detects.
    const p = world({
      [PROJECTION_COLLECTION]: [
        {
          offeringId: 'offering-1',
          name: 'The old name',
          legacyMember: 'should not survive',
        },
      ],
    });

    await p.apply(CATALOG_PUBLISHED, { name: 'The corrected name' });

    expect(p.fake.read(PROJECTION_COLLECTION)).toHaveLength(1);
    expect(p.record?.['name']).toBe('The corrected name');
    expect(p.record).not.toHaveProperty('legacyMember');
  });

  it('removes the record on an unpublication, and removes nothing without failing', async () => {
    // Deleting nothing is what a redelivery looks like; failing would requeue
    // a message that succeeded until the broker quarantined it.
    const live = world({
      [PROJECTION_COLLECTION]: [{ offeringId: 'offering-1' }],
    });
    const empty = world();

    expect(await live.apply(CATALOG_UNPUBLISHED)).toBe('applied');
    expect(await empty.apply(CATALOG_UNPUBLISHED)).toBe('applied');
    expect(live.record).toBeUndefined();
  });

  it('reports a driver failure rather than swallowing it', async () => {
    // Swallowing it would acknowledge a message the projection never took.
    const p = world();
    p.fake.failOn('findOne', new Error('replica set unreachable'));

    await expect(p.apply(CATALOG_PUBLISHED)).rejects.toThrow();
  });

  it('fails to build when the stamp index cannot be ensured', async () => {
    const p = world();
    p.fake.failOn('createIndex', new Error('not primary'));

    await expect(p.apply(CATALOG_PUBLISHED)).rejects.toThrow();
  });
});

describe('the ordering guard', () => {
  it('applies a publication newer than the stamp, and ignores an older one', async () => {
    const newer = world(stampAt(new Date('2026-09-07T09:00:00.000Z')));
    const older = world(stampAt(new Date('2026-09-07T11:00:00.000Z')));

    expect(await newer.apply(CATALOG_PUBLISHED)).toBe('applied');
    expect(await older.apply(CATALOG_PUBLISHED)).toBe('stale');
    expect(older.record).toBeUndefined();
  });

  /**
   * ⚠️ The failure this whole guard exists for: publish at 10:00, unpublish
   * at 10:30, republish at 11:00 — then the 10:30 unpublication is redelivered.
   */
  it('ignores a stale unpublication that would delete a live listing', async () => {
    const p = world();
    await p.apply(CATALOG_PUBLISHED, at('2026-09-07T11:00:00.000Z'));

    expect(
      await p.apply(CATALOG_UNPUBLISHED, at('2026-09-07T10:30:00.000Z')),
    ).toBe('stale');
    expect(p.record).toMatchObject({ offeringId: 'offering-1' });
  });

  it('re-applies an exact redelivery, because equal is not older', async () => {
    const p = world(stampAt(new Date(PUBLICATION.publishedAt)));

    expect(await p.apply(CATALOG_PUBLISHED)).toBe('applied');
  });

  it('treats a stamp with a non-date moment as no moment rather than trusting it', async () => {
    // A string would compare as `NaN`, false in every direction, which reads as
    // "always stale" and freezes the offering.
    const p = world(stampAt('2026-09-07T11:00:00.000Z'));

    expect(await p.apply(CATALOG_PUBLISHED)).toBe('applied');
  });
});

describe('the stamp, and the race it exists for', () => {
  /**
   * ⚠️ Measured against the running fleet: publishing and unpublishing 19ms
   * apart raced two outbox drains, the unpublication landed first and left
   * nothing behind, and the older publication that followed looked like a
   * first one. The storefront went on showing an unpublished offering.
   */
  it('does not resurrect an offering when an older publication arrives after the delete', async () => {
    const p = world();

    await p.apply(CATALOG_UNPUBLISHED, at('2026-09-07T10:00:01.000Z'));
    const late = await p.apply(
      CATALOG_PUBLISHED,
      at('2026-09-07T10:00:00.000Z'),
    );

    expect(late).toBe('stale');
    expect(p.record).toBeUndefined();
  });

  it('keeps the moment the offering came down, and moves it on a newer publication', async () => {
    // The guard orders, it does not freeze: a vendor who changes their mind
    // has to reach the storefront again.
    const p = world();

    await p.apply(CATALOG_UNPUBLISHED, at('2026-09-07T10:00:00.000Z'));
    expect(p.stamp).toEqual({
      offeringId: 'offering-1',
      publishedAt: new Date('2026-09-07T10:00:00.000Z'),
    });

    await p.apply(CATALOG_PUBLISHED, at('2026-09-07T11:00:00.000Z'));
    expect(p.record).toMatchObject({ offeringId: 'offering-1' });
    expect(p.stamp?.['publishedAt']).toEqual(
      new Date('2026-09-07T11:00:00.000Z'),
    );
  });

  it('never walks the stamp backwards on an older unpublication', async () => {
    const p = world(stampAt(new Date('2026-09-07T12:00:00.000Z')));

    await p.apply(CATALOG_UNPUBLISHED, at('2026-09-07T10:00:00.000Z'));

    expect(p.stamp?.['publishedAt']).toEqual(
      new Date('2026-09-07T12:00:00.000Z'),
    );
  });
});

describe('the payload and the record it is written into', () => {
  it('holds a member for every member of the publication', () => {
    // ⚠️ `CatalogPublication` is authored by one domain and projected into
    // another that may not import it. A member with no home on the entity is a
    // field the projector silently never writes.
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
      media: true,
    };

    for (const member of Object.keys(publication)) {
      expect(
        columns,
        `CatalogPublication carries '${member}' and PublishedOffering has nowhere to put it`,
      ).toContain(member);
    }
  });

  it('writes a key for every member the publication carried', async () => {
    // The half the pin above cannot see: `serializeEntity` skips a `hidden` or
    // `readonly` accessor, which would drop a snapshot member with the mapping
    // still green.
    const p = world();
    await p.apply(CATALOG_PUBLISHED);

    for (const member of Object.keys(PUBLICATION)) {
      expect(
        p.record,
        `the publication carried '${member}' and the projected document does not`,
      ).toHaveProperty(member);
    }
  });

  it('omits an absent optional rather than storing null, including one the vendor cleared', async () => {
    const p = world();
    await p.apply(CATALOG_PUBLISHED, at('2026-09-07T09:00:00.000Z'));

    await p.apply(CATALOG_PUBLISHED, {
      code: undefined,
      description: undefined,
      brandId: undefined,
      categoryId: undefined,
      media: undefined,
    });

    const keys = Object.keys(p.record ?? {});
    for (const absent of [
      'code',
      'description',
      'brandId',
      'categoryId',
      'media',
    ]) {
      expect(keys).not.toContain(absent);
    }
  });

  it("projects the media as plain url and alt values, in the vendor's order", async () => {
    const p = world();
    const media = [
      { url: 'https://cdn.example/front.jpg', alt: 'Front' },
      { url: 'https://cdn.example/back.jpg', alt: 'Back' },
    ];

    await p.apply(CATALOG_PUBLISHED, { media });

    expect(p.record?.['media']).toEqual(media);
  });
});
