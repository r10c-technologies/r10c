import { EntityRepositoryTag } from '@entifix/business';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { PublishedVendor } from '@r10c/business-ts-marketplace-vendor';
import { Context, Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { getVendor, loadVendors, VENDOR_PAGE_SIZE } from './vendors.js';

/**
 * The generic load use case over an in-memory repository: what is under test
 * is the request each read builds, never a transport.
 */
const vendor = (vendorId: string, displayName: string) => {
  const one = new PublishedVendor(vendorId, displayName);
  one.id = vendorId;
  return one;
};

const VENDORS = [
  vendor('org-2', 'Terra Studio'),
  vendor('org-1', 'Aurora Lights'),
  vendor('org-3', 'Nimbus Textiles'),
];

const run = <A>(read: Effect.Effect<A, unknown, EntityRepositoryTag>) => {
  const repository = makeInMemoryEntityRepository(VENDORS);
  const load = vi.spyOn(repository, 'load');
  const result = Effect.runPromise(
    read.pipe(
      Effect.provide(Context.make(EntityRepositoryTag, repository)),
    ) as Effect.Effect<A>,
  );
  return { result, load };
};

const namesOf = (vendors: readonly PublishedVendor[]) =>
  vendors.map(one => one.displayName);

describe('loadVendors', () => {
  it('lists every seller by name when it is asked for none in particular', async () => {
    const { result, load } = run(loadVendors());

    expect(namesOf(await result)).toEqual([
      'Aurora Lights',
      'Nimbus Textiles',
      'Terra Studio',
    ]);
    expect(load.mock.calls[0]?.[0]).toMatchObject({
      pageSize: VENDOR_PAGE_SIZE,
    });
  });

  it('names only the sellers a page of offerings carries', async () => {
    const { result } = run(loadVendors(['org-3', 'org-2']));

    expect(namesOf(await result)).toEqual(['Nimbus Textiles', 'Terra Studio']);
  });

  it('reads nothing at all for an empty list, which asks for nobody', async () => {
    const { result, load } = run(loadVendors([]));

    expect(await result).toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });
});

describe('getVendor', () => {
  it('finds one seller by its vendor id', async () => {
    const { result } = run(getVendor('org-1'));

    expect((await result)?.displayName).toBe('Aurora Lights');
  });

  it('answers undefined for a vendor nothing was announced for', async () => {
    const { result } = run(getVendor('org-404'));

    expect(await result).toBeUndefined();
  });
});
