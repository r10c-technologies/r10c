import {
  CATALOG_PUBLISHED,
  CATALOG_UNPUBLISHED,
  type CatalogPublication,
} from '@r10c/business-ts-catalog-contracts';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { PublishedCatalog } from '../ports/published-catalog';

/** A projection under test, and a way to ask whether an offering is listed. */
export interface PublishedCatalogSubject {
  readonly catalog: PublishedCatalog;
  readonly isListed: (offeringId: string) => Promise<boolean>;
}

const at = (minute: number) =>
  `2026-10-25T10:${String(minute).padStart(2, '0')}:00.000Z`;

const publication = (
  publishedAt: string,
  offeringId = 'o-1',
): CatalogPublication => ({
  offeringId,
  vendorId: 'acme',
  name: 'A mug',
  amount: 100,
  currency: 'GTQ',
  availableHint: true,
  publishedAt,
});

/**
 * What every {@link PublishedCatalog} must guarantee, through the port and a
 * read of what is listed: a publication or an unpublication applies only if
 * it is at least as recent as the last one applied to its offering, so a
 * redelivered unpublication can never delete a newer listing, nor a stale
 * publication resurrect a withdrawn one (#357). Offerings are ordered apart.
 *
 * `make` returns a fresh, empty projection.
 *
 * Deliberately not asserted: a publish and an unpublish racing on one
 * offering. That is the per-offering stamp against a real server (ADR 0048,
 * ADR 0063), proven by the live burst.
 */
export const describePublishedCatalogContract = (
  name: string,
  make: () => PublishedCatalogSubject | Promise<PublishedCatalogSubject>,
) => {
  describe(`${name} honours the PublishedCatalog contract`, () => {
    const apply = (
      { catalog }: PublishedCatalogSubject,
      eventName: string,
      publishedAt: string,
      offeringId?: string,
    ) =>
      Effect.runPromise(
        catalog.apply(eventName, publication(publishedAt, offeringId)),
      );

    it('lists a publication, and applies a newer or equal one over it', async () => {
      const subject = await make();

      const first = await apply(subject, CATALOG_PUBLISHED, at(1));
      const same = await apply(subject, CATALOG_PUBLISHED, at(1));
      const newer = await apply(subject, CATALOG_PUBLISHED, at(2));

      expect([first, same, newer]).toEqual(['applied', 'applied', 'applied']);
      expect(await subject.isListed('o-1')).toBe(true);
    });

    it('refuses a publication older than the last one applied', async () => {
      const subject = await make();
      await apply(subject, CATALOG_PUBLISHED, at(5));

      expect(await apply(subject, CATALOG_PUBLISHED, at(4))).toBe('stale');
    });

    it('withdraws on a newer unpublication, and lets no older publication bring it back', async () => {
      const subject = await make();
      await apply(subject, CATALOG_PUBLISHED, at(1));

      const withdrawn = await apply(subject, CATALOG_UNPUBLISHED, at(3));
      const resurrected = await apply(subject, CATALOG_PUBLISHED, at(2));

      expect([withdrawn, resurrected]).toEqual(['applied', 'stale']);
      expect(await subject.isListed('o-1')).toBe(false);
    });

    it('lets no redelivered unpublication delete a newer listing', async () => {
      const subject = await make();
      await apply(subject, CATALOG_PUBLISHED, at(5));

      expect(await apply(subject, CATALOG_UNPUBLISHED, at(4))).toBe('stale');
      expect(await subject.isListed('o-1')).toBe(true);
    });

    it('orders each offering on its own', async () => {
      const subject = await make();
      await apply(subject, CATALOG_UNPUBLISHED, at(9), 'o-1');

      expect(await apply(subject, CATALOG_PUBLISHED, at(1), 'o-2')).toBe(
        'applied',
      );
      expect(await subject.isListed('o-2')).toBe(true);
    });
  });
};
