import { catalogPublishedEvent } from '@r10c/business-ts-catalog-contracts';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { ProductOffering } from '../entities/product-offering';
import { ProductOfferingPrice } from '../entities/product-offering-price';
import type { OfferingCatalog } from '../ports/offering-catalog';

/**
 * What every subject is made with: `acme` holds a draft `o-1` at revision 1
 * and a seeded draft `o-seeded`, which has no revision; `other` nothing.
 */
export const CONTRACT_OFFERINGS = {
  acme: [
    { id: 'o-1', status: 'draft' as const, revision: 1 },
    { id: 'o-seeded', status: 'draft' as const },
  ],
  other: [],
} as const;

/**
 * The prices every subject is made with: `acme` holds `p-1` at revision 1 and
 * a seeded `p-seeded`, which has no revision; `other` nothing.
 */
export const CONTRACT_PRICES = {
  acme: [{ id: 'p-1', revision: 1 }, { id: 'p-seeded' }],
  other: [],
} as const;

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

/** A price as `set-price-tiers` decided it, at the revision it was read at. */
const tiered = (id: string, revision?: number) =>
  Object.assign(new ProductOfferingPrice('o-1', 1250, 'GTQ'), {
    id,
    revision,
    tiers: [{ from: 10, amount: 1100 }],
  });

/** The offering as a transition decided it, at the revision it was read at. */
const moved = (status: ProductOffering['status'], revision = 1) =>
  Object.assign(new ProductOffering('A mug', 'spec-1'), {
    id: 'o-1',
    status,
    revision,
  });

const announcement = (publishedAt: string) =>
  catalogPublishedEvent(
    {
      offeringId: 'o-1',
      vendorId: 'acme',
      name: 'A mug',
      amount: 100,
      currency: 'GTQ',
      availableHint: true,
      publishedAt,
      specificationId: 'spec-1',
      specificationVersion: 1,
      saleUnit: 'UN',
      quantityStep: 1,
      quantityMinimum: 1,
      pricePer: 1,
    },
    'contract',
  );

/**
 * What every {@link OfferingCatalog} must guarantee, through the port alone: a
 * transition commits only from the status and revision it was decided
 * against, so the
 * loser of two transitions read from one status is told `changed` (#371), and
 * an announcement is enqueued once however often it is re-stated.
 *
 * `make` returns a fresh catalog seeded with {@link CONTRACT_OFFERINGS}.
 *
 * Deliberately not asserted: the two transitions racing, and an announcement
 * revived out of quarantine — the first is the conditional write against a
 * real server (ADR 0063), the second needs the relay to have given up on it.
 */
export const describeOfferingCatalogContract = (
  name: string,
  make: () => OfferingCatalog | Promise<OfferingCatalog>,
) => {
  describe(`${name} honours the OfferingCatalog contract`, () => {
    it('commits a transition from the status it was decided against, and refuses the loser', async () => {
      const catalog = await make();

      const won = await run(
        catalog.commitTransition(
          'acme',
          moved('published'),
          'draft',
          announcement('2026-10-25T10:00:00.000Z'),
        ),
      );
      const lost = await run(
        catalog.commitTransition(
          'acme',
          moved('unpublished'),
          'draft',
          announcement('2026-10-25T10:00:01.000Z'),
        ),
      );
      const next = await run(
        catalog.commitTransition(
          'acme',
          moved('unpublished', 2),
          'published',
          announcement('2026-10-25T10:00:02.000Z'),
        ),
      );

      expect([won, lost, next]).toEqual(['committed', 'changed', 'committed']);
    });

    it('refuses a transition decided on a revision a save has since replaced', async () => {
      const catalog = await make();

      // The status still matches: only the revision says what was decided on
      // is not what is stored, and committing would write it over the save.
      expect(
        await run(
          catalog.commitTransition(
            'acme',
            moved('published', 0),
            'draft',
            announcement('2026-10-25T10:00:00.000Z'),
          ),
        ),
      ).toBe('changed');
    });

    it('moves a seeded offering, which has no revision until it first moves', async () => {
      const catalog = await make();
      const seeded = Object.assign(new ProductOffering('A mug', 'spec-1'), {
        id: 'o-seeded',
        status: 'published' as const,
      });

      expect(
        await run(
          catalog.commitTransition(
            'acme',
            seeded,
            'draft',
            announcement('2026-10-25T10:00:00.000Z'),
          ),
        ),
      ).toBe('committed');
    });

    it('answers changed for an offering the organization does not hold', async () => {
      const catalog = await make();

      expect(
        await run(
          catalog.commitTransition(
            'other',
            moved('published'),
            'draft',
            announcement('2026-10-25T10:00:00.000Z'),
          ),
        ),
      ).toBe('changed');
    });

    it('sets the unit of an offering never published, at the revision it was read at', async () => {
      const catalog = await make();
      const read = Object.assign(moved('draft'), { saleUnit: 'M' as const });

      expect(await run(catalog.setSaleUnit('acme', read))).toBe('committed');
      // The write moved the revision: the same read cannot write twice.
      expect(await run(catalog.setSaleUnit('acme', read))).toBe('changed');
    });

    it('refuses a unit for an offering published since it was read', async () => {
      const catalog = await make();
      await run(
        catalog.commitTransition(
          'acme',
          moved('published'),
          'draft',
          announcement('2026-10-25T10:00:00.000Z'),
        ),
      );

      expect(await run(catalog.setSaleUnit('acme', moved('draft', 2)))).toBe(
        'changed',
      );
    });

    it('sets the unit of a seeded offering, which has no revision yet', async () => {
      const catalog = await make();
      const seeded = Object.assign(new ProductOffering('A mug', 'spec-1'), {
        id: 'o-seeded',
        status: 'draft' as const,
      });

      expect(await run(catalog.setSaleUnit('acme', seeded))).toBe('committed');
    });

    it('answers changed for a unit on an offering the organization does not hold', async () => {
      const catalog = await make();

      expect(await run(catalog.setSaleUnit('other', moved('draft')))).toBe(
        'changed',
      );
    });

    it('sets a stock source at the revision it was read at, once, whatever the status', async () => {
      const catalog = await make();
      const read = Object.assign(moved('pending-review'), {
        stockOfferingId: 'o-seeded',
        stockFactor: 100,
      });

      expect(await run(catalog.setStockSource('acme', read))).toBe('committed');
      expect(await run(catalog.setStockSource('acme', read))).toBe('changed');
    });

    it('stops an offering drawing on a base at the revision it was read at', async () => {
      const catalog = await make();
      const cleared = Object.assign(moved('draft'), {
        stockOfferingId: undefined,
        stockFactor: undefined,
      });

      expect(await run(catalog.setStockSource('acme', cleared))).toBe(
        'committed',
      );
    });

    it('sets the stock source of a seeded offering, which has no revision yet', async () => {
      const catalog = await make();
      const seeded = Object.assign(new ProductOffering('A box', 'spec-1'), {
        id: 'o-seeded',
        stockOfferingId: 'o-1',
        stockFactor: 12,
      });

      expect(await run(catalog.setStockSource('acme', seeded))).toBe(
        'committed',
      );
    });

    it('answers changed for a stock source on an offering the organization does not hold', async () => {
      const catalog = await make();

      expect(await run(catalog.setStockSource('other', moved('draft')))).toBe(
        'changed',
      );
    });

    it('sets a price’s tiers at the revision it was read at, once', async () => {
      const catalog = await make();

      expect(await run(catalog.setPriceTiers('acme', tiered('p-1', 1)))).toBe(
        'committed',
      );
      expect(await run(catalog.setPriceTiers('acme', tiered('p-1', 1)))).toBe(
        'changed',
      );
    });

    it('removes a price’s tiers at the revision it was read at', async () => {
      const catalog = await make();
      const cleared = Object.assign(tiered('p-1', 1), { tiers: undefined });

      expect(await run(catalog.setPriceTiers('acme', cleared))).toBe(
        'committed',
      );
    });

    it('sets the tiers of a seeded price, which has no revision yet', async () => {
      const catalog = await make();

      expect(await run(catalog.setPriceTiers('acme', tiered('p-seeded')))).toBe(
        'committed',
      );
    });

    it('answers changed for tiers on a price the organization does not hold', async () => {
      const catalog = await make();

      expect(await run(catalog.setPriceTiers('other', tiered('p-1', 1)))).toBe(
        'changed',
      );
    });

    it('enqueues a re-stated announcement once', async () => {
      const catalog = await make();
      const event = announcement('2026-10-25T10:00:00.000Z');

      const first = await run(catalog.reannounce('acme', event));
      const again = await run(catalog.reannounce('acme', event));

      expect([first, again]).toEqual(['announced', 'alreadyAnnounced']);
    });

    it('treats an announcement a transition already made as made', async () => {
      const catalog = await make();
      const event = announcement('2026-10-25T10:00:00.000Z');
      await run(
        catalog.commitTransition('acme', moved('published'), 'draft', event),
      );

      expect(await run(catalog.reannounce('acme', event))).toBe(
        'alreadyAnnounced',
      );
    });
  });
};
