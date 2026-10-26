import { catalogPublishedEvent } from '@r10c/business-ts-catalog-contracts';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { ProductOffering } from '../entities/product-offering';
import type { OfferingCatalog } from '../ports/offering-catalog';

/** What every subject is made with: `acme` holds a draft `o-1`, `other` nothing. */
export const CONTRACT_OFFERINGS = {
  acme: [{ id: 'o-1', status: 'draft' as const }],
  other: [],
} as const;

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

const moved = (status: ProductOffering['status']) =>
  Object.assign(new ProductOffering('A mug', 'spec-1'), { id: 'o-1', status });

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
    },
    'contract',
  );

/**
 * What every {@link OfferingCatalog} must guarantee, through the port alone: a
 * transition commits only from the status it was decided against, so the
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
          moved('unpublished'),
          'published',
          announcement('2026-10-25T10:00:02.000Z'),
        ),
      );

      expect([won, lost, next]).toEqual(['committed', 'changed', 'committed']);
    });

    it("answers changed for an offering the organization does not hold", async () => {
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
