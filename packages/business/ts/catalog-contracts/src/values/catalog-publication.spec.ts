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

  it('drops members the contract does not declare', () => {
    // A publisher that adds a member before the consumer knows it must not have
    // that member written into the projection by accident.
    const extra = { ...PUBLICATION, secretCost: 1 } as unknown;

    expect(Effect.runSync(readCatalogPublication(extra))).toEqual(PUBLICATION);
  });
});
