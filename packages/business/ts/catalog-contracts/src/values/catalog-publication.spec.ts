import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  CATALOG_EVENTS,
  CATALOG_PUBLISHED,
  CATALOG_UNPUBLISHED,
  catalogEventId,
  type CatalogPublication,
  catalogPublishedEvent,
  catalogUnpublishedEvent,
  readCatalogPublication,
} from './catalog-publication.js';

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

/** The seven members every publication must carry to be readable at all. */
const REQUIRED = {
  offeringId: PUBLICATION.offeringId,
  vendorId: PUBLICATION.vendorId,
  name: PUBLICATION.name,
  amount: PUBLICATION.amount,
  currency: PUBLICATION.currency,
  availableHint: PUBLICATION.availableHint,
  publishedAt: PUBLICATION.publishedAt,
};

const read = (data: unknown) =>
  Effect.runSyncExit(readCatalogPublication(data));

/** The reason a decode failed, as the caller would see it. */
const failureMessage = (data: unknown): string => {
  const exit = read(data);
  if (Exit.isSuccess(exit)) throw new Error('expected the decode to fail');
  return String(exit.cause);
};

describe('catalog event names', () => {
  it('routes both states through the same first word', () => {
    // The consumer binds one queue with the pattern `catalog.*`, so both names
    // must share a first word or one of them silently reaches nobody.
    for (const name of CATALOG_EVENTS) {
      expect(name.startsWith('catalog.')).toBe(true);
    }
  });

  it('names exactly the two states the lifecycle can announce', () => {
    // Pinned: a third name added here without a register entry is a message the
    // broker routes to no queue, which reads as a healthy publish.
    expect(CATALOG_EVENTS).toEqual([CATALOG_PUBLISHED, CATALOG_UNPUBLISHED]);
  });
});

describe('catalogEventId', () => {
  it('keys on the offering and the moment, so a republication is its own message', () => {
    // ADR 0047 makes `published → published` legal because republication is how
    // a vendor's correction reaches the storefront. Keyed on the offering alone,
    // the correction would look like a redelivery of the first publication and
    // the outbox's unique index would drop it.
    const corrected = {
      ...PUBLICATION,
      publishedAt: '2026-09-07T11:00:00.000Z',
    };

    expect(catalogEventId(PUBLICATION)).not.toBe(catalogEventId(corrected));
  });

  it('gives one publication one id, however many times it is asked', () => {
    expect(catalogEventId(PUBLICATION)).toBe(
      catalogEventId({ ...PUBLICATION }),
    );
  });
});

describe('the event builders', () => {
  it('stamps the emitting slice as the source', () => {
    const event = catalogPublishedEvent(PUBLICATION, 'marketplace-admin');

    expect(event.source).toBe('marketplace-admin');
  });

  it('takes `at` from the publication rather than from the clock', () => {
    // The message's time and the payload's ordering key must be the same fact.
    // Read from a clock here, a redelivery built a second time would carry a
    // later `at` than the publication it announces.
    const event = catalogPublishedEvent(PUBLICATION, 'marketplace-admin');

    expect(event.at).toBe(PUBLICATION.publishedAt);
  });

  it('correlates on the offering, which is what ties the two states together', () => {
    expect(
      catalogUnpublishedEvent(PUBLICATION, 'marketplace-admin').correlationId,
    ).toBe(PUBLICATION.offeringId);
  });

  it('names each event for the state it announces', () => {
    expect(catalogPublishedEvent(PUBLICATION, 'marketplace-admin').name).toBe(
      CATALOG_PUBLISHED,
    );
    expect(catalogUnpublishedEvent(PUBLICATION, 'marketplace-admin').name).toBe(
      CATALOG_UNPUBLISHED,
    );
  });

  it('carries the whole snapshot on an unpublication too', () => {
    // An unpublication could carry `offeringId` alone. It deliberately does not:
    // the consumer's guard compares `publishedAt`, and a payload that changes
    // shape by event name is two decoders and two ways to skip that guard.
    expect(
      catalogUnpublishedEvent(PUBLICATION, 'marketplace-admin').data,
    ).toEqual(PUBLICATION);
  });
});

describe('readCatalogPublication', () => {
  it('reads a well-formed payload back unchanged', () => {
    expect(Effect.runSync(readCatalogPublication(PUBLICATION))).toEqual(
      PUBLICATION,
    );
  });

  it('survives the round trip through JSON, which is how it actually arrives', () => {
    const wire: unknown = JSON.parse(JSON.stringify(PUBLICATION));

    expect(Effect.runSync(readCatalogPublication(wire))).toEqual(PUBLICATION);
  });

  it.each([
    ['null', null],
    ['a string', 'catalog.published'],
    ['a number', 7],
  ])('rejects %s rather than coercing it', (_label, data) => {
    expect(failureMessage(data)).toContain('is not an object');
  });

  it.each([
    'offeringId',
    'vendorId',
    'name',
    'currency',
    'publishedAt',
    'amount',
    'availableHint',
  ])('names %s when it is absent', member => {
    const withoutMember = Object.fromEntries(
      Object.entries(PUBLICATION).filter(([key]) => key !== member),
    );

    expect(failureMessage(withoutMember)).toContain(member);
  });

  it.each(['offeringId', 'vendorId', 'name', 'currency', 'publishedAt'])(
    'rejects an empty %s, which is absent wearing the right type',
    member => {
      expect(failureMessage({ ...PUBLICATION, [member]: '' })).toContain(
        member,
      );
    },
  );

  it('rejects a NaN amount, which is a number and still not a price', () => {
    // `typeof NaN === 'number'`, so a type check alone lets it through — into
    // Mongo, and out again as a rendered price.
    expect(failureMessage({ ...PUBLICATION, amount: Number.NaN })).toContain(
      'amount',
    );
  });

  it('rejects an infinite amount for the same reason', () => {
    expect(
      failureMessage({ ...PUBLICATION, amount: Number.POSITIVE_INFINITY }),
    ).toContain('amount');
  });

  it('rejects an amount sent as a string', () => {
    expect(failureMessage({ ...PUBLICATION, amount: '24900' })).toContain(
      'amount',
    );
  });

  it('rejects a truthy non-boolean availableHint', () => {
    // A hint that arrives as `'true'` is truthy everywhere it is read, so
    // coercing here would make an unavailable offering look available.
    expect(failureMessage({ ...PUBLICATION, availableHint: 'true' })).toContain(
      'availableHint',
    );
  });

  it('accepts a zero amount, because free is a price', () => {
    expect(
      Effect.runSync(readCatalogPublication({ ...PUBLICATION, amount: 0 }))
        .amount,
    ).toBe(0);
  });

  it('accepts availableHint false', () => {
    expect(
      Effect.runSync(
        readCatalogPublication({ ...PUBLICATION, availableHint: false }),
      ).availableHint,
    ).toBe(false);
  });

  it('reports every malformed member at once', () => {
    // One trip to the quarantine should say everything that is wrong with the
    // message, not the first thing.
    const message = failureMessage({ offeringId: 'offering-1' });

    for (const member of [
      'vendorId',
      'name',
      'currency',
      'publishedAt',
      'amount',
      'availableHint',
    ]) {
      expect(message).toContain(member);
    }
  });

  it.each(['code', 'description', 'brandId', 'categoryId'])(
    'reads %s when the specification carried one',
    member => {
      expect(Effect.runSync(readCatalogPublication(PUBLICATION))).toHaveProperty(
        member,
        PUBLICATION[member as keyof CatalogPublication],
      );
    },
  );

  it('decodes a payload carrying none of the merchandising members', () => {
    // ⚠️ The anti-poison assertion, and the reason all four are optional.
    //
    // A rejected payload is classified poison and quarantined with **zero**
    // retries (ADR 0030) — it never becomes readable, and nothing retries it
    // into existence. A specification legitimately has no description, no brand
    // and no category, and a `PUT` that omits `code` blanks it, so requiring any
    // of them would make that vendor's offering permanently unannounceable with
    // the only evidence in another service's log. It also means every message
    // already sitting in the queue survives this shape widening.
    expect(Effect.runSync(readCatalogPublication(REQUIRED))).toEqual(REQUIRED);
  });

  it.each([
    ['absent', undefined],
    ['null, which is what BSON stores for an assigned undefined', null],
    ['empty, which is a label that renders as nothing', ''],
    ['a number', 7],
  ])('reads a %s description as undefined rather than failing', (_l, value) => {
    const publication = Effect.runSync(
      readCatalogPublication({ ...REQUIRED, description: value }),
    );

    expect(publication.description).toBeUndefined();
  });

  it('reads null merchandising members as undefined, not as a failure', () => {
    // ⚠️ `null` is not hypothetical. The event is written to the outbox before
    // it is published, `MongoClientLayer` does not set `ignoreUndefined`, and
    // BSON writes `undefined` as `null` — so a reader that accepted only
    // `string | undefined` would quarantine a message this fleet produced
    // itself.
    const publication = Effect.runSync(
      readCatalogPublication({
        ...REQUIRED,
        code: null,
        description: null,
        brandId: null,
        categoryId: null,
      }),
    );

    expect(publication).toEqual(REQUIRED);
  });

  it('keeps the message id out of the widening', () => {
    // The dedup key is `<offeringId>:<publishedAt>` and nothing else. A key that
    // moved with the payload would make every offering already projected look
    // like a first publication.
    expect(catalogEventId(PUBLICATION)).toBe(
      catalogEventId({ ...PUBLICATION, description: 'edited', code: undefined }),
    );
  });

  it('drops members the contract does not declare', () => {
    // A publisher that adds a member before the consumer knows it must not have
    // that member written into the projection by accident.
    const extra = { ...PUBLICATION, secretCost: 1 } as unknown;

    expect(Effect.runSync(readCatalogPublication(extra))).toEqual(PUBLICATION);
  });
});
