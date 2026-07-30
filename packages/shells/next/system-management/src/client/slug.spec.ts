import { describe, expect, it } from 'vitest';

import { NEW_SLUG, slugToEntityId } from './slug.js';

describe('slugToEntityId', () => {
  it('maps a record slug to its id', () => {
    expect(slugToEntityId('c-1')).toBe('c-1');
  });

  it('maps the create slug to nothing to load', () => {
    expect(slugToEntityId(NEW_SLUG)).toBeUndefined();
  });

  it('maps an absent slug to nothing to load', () => {
    expect(slugToEntityId(undefined)).toBeUndefined();
  });
});
