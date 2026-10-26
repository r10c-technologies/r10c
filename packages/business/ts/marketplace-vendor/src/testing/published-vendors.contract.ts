import type { OrganizationAnnouncement } from '@r10c/business-ts-party-contracts';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { PublishedVendors } from '../ports/published-vendors';

/** A projection under test, and a way to read the name it shows a vendor under. */
export interface PublishedVendorsSubject {
  readonly vendors: PublishedVendors;
  readonly displayNameOf: (vendorId: string) => Promise<string | undefined>;
}

const announcement = (
  displayName: string,
  minute: number,
  organizationId = 'acme',
): OrganizationAnnouncement => ({
  organizationId,
  displayName,
  announcedAt: `2026-10-25T10:${String(minute).padStart(2, '0')}:00.000Z`,
});

/**
 * What every {@link PublishedVendors} must guarantee, through the port and a
 * read of the name it shows: an announcement applies only if it is at least
 * as recent as the last one applied to its organization, so a rebuild walk
 * re-stating an old name cannot outrank a rename (ADR 0061).
 *
 * `make` returns a fresh, empty projection.
 *
 * Deliberately not asserted: two announcements racing for one vendor's first
 * row. That is the unique index against a real server (ADR 0063).
 */
export const describePublishedVendorsContract = (
  name: string,
  make: () => PublishedVendorsSubject | Promise<PublishedVendorsSubject>,
) => {
  describe(`${name} honours the PublishedVendors contract`, () => {
    const apply = (
      { vendors }: PublishedVendorsSubject,
      value: OrganizationAnnouncement,
    ) => Effect.runPromise(vendors.apply(value));

    it('shows the newest name, re-stated or not', async () => {
      const subject = await make();

      const first = await apply(subject, announcement('Acme', 1));
      const restated = await apply(subject, announcement('Acme', 1));
      const renamed = await apply(subject, announcement('Acme & Sons', 2));

      expect([first, restated, renamed]).toEqual([
        'applied',
        'applied',
        'applied',
      ]);
      expect(await subject.displayNameOf('acme')).toBe('Acme & Sons');
    });

    it('lets no older name outrank a rename', async () => {
      const subject = await make();
      await apply(subject, announcement('Acme & Sons', 5));

      expect(await apply(subject, announcement('Acme', 4))).toBe('stale');
      expect(await subject.displayNameOf('acme')).toBe('Acme & Sons');
    });

    it('orders each vendor on its own', async () => {
      const subject = await make();
      await apply(subject, announcement('Acme', 9));

      expect(await apply(subject, announcement('Globex', 1, 'globex'))).toBe(
        'applied',
      );
      expect(await subject.displayNameOf('globex')).toBe('Globex');
      expect(await subject.displayNameOf('initech')).toBeUndefined();
    });
  });
};
