import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { ProductOffering } from './product-offering.entity.js';

describe('ProductOffering', () => {
  it('serializes the offering with the specification version it pins', () => {
    const offering = new ProductOffering(
      'Blue widget, 3-pack',
      'product-specification-1',
    );
    offering.id = 'off-1';
    offering.status = 'published';
    offering.statusChangedAt = new Date('2026-03-04T05:06:07.008Z');

    expect(serializeEntity(ProductOffering, offering)).toEqual({
      id: 'off-1',
      name: 'Blue widget, 3-pack',
      specificationId: 'product-specification-1',
      status: 'published',
      statusChangedAt: new Date('2026-03-04T05:06:07.008Z'),
    });
  });

  it('rebuilds itself from a stored record', async () => {
    const offering = await Effect.runPromise(
      deserializeSingleEntity(ProductOffering, {
        id: 'off-2',
        name: 'Red widget',
        specificationId: 'product-specification-2',
        status: 'pending-review',
      }),
    );

    expect(offering?.name).toBe('Red widget');
    expect(offering?.specificationId).toBe('product-specification-2');
    expect(offering?.status).toBe('pending-review');
  });

  it('opens as a draft, so authoring never publishes by omission', () => {
    const offering = new ProductOffering();

    expect(offering.name).toBe('');
    expect(offering.specificationId).toBe('');
    expect(offering.status).toBe('draft');
    // Nothing has been decided about it yet, so there is no moment to carry —
    // and the rebuild walk reads that absence rather than a fabricated `now`.
    expect(offering.statusChangedAt).toBeUndefined();
  });

  it('accepts the setters a repository writes back through', () => {
    const offering = new ProductOffering();
    offering.name = 'Green widget';
    offering.specificationId = 'product-specification-3';
    offering.status = 'unpublished';
    offering.statusChangedAt = new Date('2026-02-01T00:00:00.000Z');

    expect(offering.name).toBe('Green widget');
    expect(offering.specificationId).toBe('product-specification-3');
    expect(offering.status).toBe('unpublished');
    expect(offering.statusChangedAt).toEqual(
      new Date('2026-02-01T00:00:00.000Z'),
    );
  });

  it('clears the moment when a setter is handed one', () => {
    // `preserveOfferingLifecycle` writes `undefined` on a create, so the setter
    // has to accept it — a member that only ever took a `Date` would leave a
    // create carrying whatever the form happened to send.
    const offering = new ProductOffering();
    offering.statusChangedAt = new Date('2026-02-01T00:00:00.000Z');
    offering.statusChangedAt = undefined;

    expect(offering.statusChangedAt).toBeUndefined();
  });

  it('rebuilds the status moment as a Date, which is what the rebuild reads', async () => {
    // ⚠️ The walk re-emits this value as the announcement's `publishedAt`, so a
    // record that deserialized it as a string would produce a different event
    // id and turn every rebuild into a fresh publication.
    const offering = await Effect.runPromise(
      deserializeSingleEntity(ProductOffering, {
        id: 'off-4',
        name: 'Amber widget',
        specificationId: 'product-specification-4',
        status: 'published',
        statusChangedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    );

    expect(offering?.statusChangedAt).toEqual(
      new Date('2026-01-01T00:00:00.000Z'),
    );
  });

  it('carries no price member, because one offering is priced several ways', () => {
    // Folding the amount in would make a promotional price, a second currency
    // and a recurring price each a second *offering* — which is how a
    // subscription turns into a new catalog instead of a new price.
    const names = describeEntityColumns(ProductOffering).map(
      column => column.name,
    );

    expect(names).toEqual([
      'id',
      'name',
      'specificationId',
      'status',
      'statusChangedAt',
    ]);
  });

  it('lets the publisher query for what is publishable', () => {
    const status = describeEntityColumns(ProductOffering).find(
      column => column.name === 'status',
    );

    expect(status?.type).toBe('enum');
    expect(status?.filterable).toBe(true);
    expect(status?.enumValues).toContain('published');
  });
});
