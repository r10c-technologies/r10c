import { ProductOffering } from '@r10c/business-ts-product-configuration-management';
import { ConfigurationRepositoryTag } from '@r10c/entifix-ts-business';
import { ConfigurationClientInMemory } from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { preserveOfferingLifecycle } from './entity-crud';

/**
 * ⚠️ This is an **authorization** test, not a tidiness one.
 *
 * `status` is an ordinary writable member, so without this guard anyone holding
 * `product-configuration-management:product-offering:write` could `POST` an
 * offering that is already `published`, or `PUT` one from `draft` straight to
 * `published`, and never go near the route that checks `…:publish`. The verb's
 * own permission would be decoration and the lifecycle a text box with four
 * suggestions.
 *
 * `statusChangedAt` rides along under the same rule and for a sharper reason:
 * it is the moment the rebuild walk re-announces from, so a `PUT` that blanks it
 * removes that offering from every future rebuild — silently, with the record
 * still reading `published` on the vendor's own screen.
 *
 * Both halves were confirmed against the running service before this was
 * written: the create and the update each came back `draft`.
 */

/** The one collection method `preserveOfferingLifecycle` reaches for. */
const dbHolding = (stored?: Record<string, unknown>) =>
  ({
    collection: () => ({
      findOne: () => Promise.resolve(stored ?? null),
    }),
  }) as unknown as Db;

const run = (offering: ProductOffering, db: Db) =>
  Effect.runPromise(
    preserveOfferingLifecycle(offering, db).pipe(
      Effect.provideService(
        ConfigurationRepositoryTag,
        new ConfigurationClientInMemory({}),
      ),
    ),
  );

const offering = (status: string, id?: string) => {
  const one = new ProductOffering('An offering', 'product-1');
  if (id !== undefined) one.id = id;
  one.status = status as ProductOffering['status'];
  return one;
};

const STORED_AT = new Date('2026-01-01T00:00:00.000Z');

describe('preserveOfferingLifecycle', () => {
  it('starts a create at draft, whatever the caller claimed', async () => {
    const created = offering('published');

    await run(created, dbHolding());

    expect(created.status).toBe('draft');
  });

  it('takes an update’s status from the stored record, not the payload', async () => {
    const submitted = offering('published', 'o-1');

    await run(
      submitted,
      dbHolding({ _id: 'o-1', name: 'An offering', status: 'draft' }),
    );

    expect(submitted.status).toBe('draft');
  });

  it('does not resurrect a status the store no longer has', async () => {
    // A record that cannot be read falls through untouched: the save that
    // follows fails on its own terms, which is a clearer answer than reporting
    // this as a status problem.
    const submitted = offering('published', 'missing');

    await run(submitted, dbHolding());

    expect(submitted.status).toBe('published');
  });

  it('leaves an unpublish that the verb already made stick', async () => {
    // The verb writes through `transitionOffering`, not this path, so a later
    // ordinary save must carry the value the verb left behind.
    const submitted = offering('draft', 'o-1');

    await run(
      submitted,
      dbHolding({ _id: 'o-1', name: 'An offering', status: 'unpublished' }),
    );

    expect(submitted.status).toBe('unpublished');
  });

  it('carries the status moment across an update that never sent one', async () => {
    // ⚠️ The half a form cannot supply: `statusChangedAt` is hidden, so an
    // ordinary edit arrives with it undefined. Without this the value is blanked
    // and the offering drops out of every future rebuild.
    const submitted = offering('published', 'o-1');

    await run(
      submitted,
      dbHolding({
        _id: 'o-1',
        name: 'An offering',
        status: 'published',
        statusChangedAt: STORED_AT,
      }),
    );

    expect(submitted.statusChangedAt).toEqual(STORED_AT);
  });

  it('refuses a moment a caller invented for an update', async () => {
    const submitted = offering('draft', 'o-1');
    submitted.statusChangedAt = new Date('2030-01-01T00:00:00.000Z');

    await run(
      submitted,
      dbHolding({
        _id: 'o-1',
        name: 'An offering',
        status: 'published',
        statusChangedAt: STORED_AT,
      }),
    );

    expect(submitted.statusChangedAt).toEqual(STORED_AT);
  });

  it('gives a create no moment at all', async () => {
    // A draft has announced nothing; the first transition stamps one. Accepting
    // a client's value here would let a create name its own place in the
    // projection's ordering.
    const created = offering('published');
    created.statusChangedAt = new Date('2030-01-01T00:00:00.000Z');

    await run(created, dbHolding());

    expect(created.statusChangedAt).toBeUndefined();
  });

  it('leaves the moment alone when the store cannot be read', async () => {
    const submitted = offering('published', 'missing');
    submitted.statusChangedAt = STORED_AT;

    await run(submitted, dbHolding());

    expect(submitted.statusChangedAt).toEqual(STORED_AT);
  });
});
