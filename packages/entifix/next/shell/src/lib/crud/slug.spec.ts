import { describe, expect, it } from 'vitest';

import { CATALOG_NEW_SLUG, slugToEntityId } from './slug.js';

// The create form is addressed through the same dynamic segment as every
// record, so one slug literal has to be reserved to mean "nothing to load".
describe('slugToEntityId', () => {
  it('maps a record slug to its id', () => {
    expect(slugToEntityId('product-1')).toBe('product-1');
  });

  it.each([
    ['the reserved create slug', CATALOG_NEW_SLUG],
    ['an absent slug', undefined],
  ])('maps %s to nothing to load', (_label, slug) => {
    expect(slugToEntityId(slug)).toBeUndefined();
  });

  // An empty segment is not the create case; treating it as a record id is
  // what surfaces the bad route as a 404 rather than silently opening a form.
  it('treats an empty slug as a record id', () => {
    expect(slugToEntityId('')).toBe('');
  });

  it('reserves exactly one literal', () => {
    expect(CATALOG_NEW_SLUG).toBe('new');
  });
});
