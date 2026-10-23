import { makeFakeMongoDb } from '@entifix/testing-unit/drivers';
import type { OrganizationAnnouncement } from '@r10c/business-ts-party-contracts';
import { Effect } from 'effect';
import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import {
  applyAnnouncement,
  ensureVendorIndexes,
  VENDOR_COLLECTION,
  vendorSubscription,
} from './publish-vendor.js';

const NAMED: OrganizationAnnouncement = {
  organizationId: 'org-1',
  displayName: 'Demo Vendor',
  announcedAt: '2026-10-23T10:00:00.000Z',
};
const RENAMED: OrganizationAnnouncement = {
  ...NAMED,
  displayName: 'Renamed Vendor',
  announcedAt: '2026-10-24T10:00:00.000Z',
};

const projection = async () => {
  const fake = makeFakeMongoDb();
  const db = fake.db as Db;
  await Effect.runPromise(ensureVendorIndexes(db));
  const apply = (announcement: OrganizationAnnouncement) =>
    Effect.runPromise(applyAnnouncement(db, announcement));
  const names = () =>
    fake.read(VENDOR_COLLECTION).map(vendor => vendor['displayName']);
  return { fake, apply, names };
};

describe('the subscription this slice binds', () => {
  it('takes every organization event on a work queue the marketplace owns', () => {
    expect(vendorSubscription).toEqual({
      slice: 'marketplace',
      pattern: 'organization.*',
      mode: 'work',
      maxAttempts: 5,
    });
  });
});

describe('applying an announcement', () => {
  it('writes the seller the storefront renders, keyed on the vendor', async () => {
    const { fake, apply } = await projection();

    expect(await apply(NAMED)).toBe('applied');

    expect(fake.read(VENDOR_COLLECTION)).toEqual([
      {
        id: 'org-1',
        vendorId: 'org-1',
        displayName: 'Demo Vendor',
        announcedAt: new Date(NAMED.announcedAt),
      },
    ]);
  });

  it('replaces the name on a later announcement, rather than adding a record', async () => {
    const { apply, names } = await projection();

    await apply(NAMED);
    await apply(RENAMED);

    expect(names()).toEqual(['Renamed Vendor']);
  });

  it('ignores an older announcement that arrives after a newer one', async () => {
    // ⚠️ The pin #392 asks for. Delivery is at-least-once, and a redelivered
    // first announcement must not put the old name back.
    const { apply, names } = await projection();

    await apply(RENAMED);

    expect(await apply(NAMED)).toBe('stale');
    expect(names()).toEqual(['Renamed Vendor']);
  });

  it('re-applies an announcement at the same moment, which writes the same record', async () => {
    const { apply, names } = await projection();

    await apply(NAMED);

    expect(await apply(NAMED)).toBe('applied');
    expect(names()).toEqual(['Demo Vendor']);
  });

  it('lands on the newer name whichever order a parallel pair runs in', async () => {
    // A read-then-write guard would let the slower of two concurrent handlers
    // win. The conditional upsert cannot be interleaved that way.
    for (const pair of [
      [NAMED, RENAMED],
      [RENAMED, NAMED],
    ]) {
      const { apply, names } = await projection();

      await Promise.all(pair.map(apply));

      expect(names()).toEqual(['Renamed Vendor']);
    }
  });

  it('fails as a connection error when the store does', async () => {
    const { fake, apply } = await projection();
    fake.failWith(new Error('down'));

    await expect(apply(NAMED)).rejects.toThrow(
      'Failed to write the published vendor',
    );
  });

  it('fails as a connection error when the index cannot be built', async () => {
    const fake = makeFakeMongoDb();
    fake.failWith(new Error('down'));

    await expect(
      Effect.runPromise(ensureVendorIndexes(fake.db as Db)),
    ).rejects.toThrow('Failed to index the published vendors');
  });
});
