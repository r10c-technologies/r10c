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
    const offering = new ProductOffering('Blue widget, 3-pack', 'spec-1-v2');
    offering.id = 'off-1';
    offering.status = 'published';

    expect(serializeEntity(ProductOffering, offering)).toEqual({
      id: 'off-1',
      name: 'Blue widget, 3-pack',
      specificationId: 'spec-1-v2',
      status: 'published',
    });
  });

  it('rebuilds itself from a stored record', async () => {
    const offering = await Effect.runPromise(
      deserializeSingleEntity(ProductOffering, {
        id: 'off-2',
        name: 'Red widget',
        specificationId: 'spec-2-v1',
        status: 'pending-review',
      }),
    );

    expect(offering?.name).toBe('Red widget');
    expect(offering?.specificationId).toBe('spec-2-v1');
    expect(offering?.status).toBe('pending-review');
  });

  it('opens as a draft, so authoring never publishes by omission', () => {
    const offering = new ProductOffering();

    expect(offering.name).toBe('');
    expect(offering.specificationId).toBe('');
    expect(offering.status).toBe('draft');
  });

  it('accepts the setters a repository writes back through', () => {
    const offering = new ProductOffering();
    offering.name = 'Green widget';
    offering.specificationId = 'spec-3-v1';
    offering.status = 'unpublished';

    expect(offering.name).toBe('Green widget');
    expect(offering.specificationId).toBe('spec-3-v1');
    expect(offering.status).toBe('unpublished');
  });

  it('carries no price member, because one offering is priced several ways', () => {
    // Folding the amount in would make a promotional price, a second currency
    // and a recurring price each a second *offering* — which is how a
    // subscription turns into a new catalog instead of a new price.
    const names = describeEntityColumns(ProductOffering).map(
      column => column.name,
    );

    expect(names).toEqual(['id', 'name', 'specificationId', 'status']);
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
