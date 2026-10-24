import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { describe, expect, it } from 'vitest';

import { assertQueryable } from './allowlist.js';

describe('assertQueryable', () => {
  it('answers the allowlist when every member is on it', () => {
    const allowed = assertQueryable(PublishedOffering, 'sortable', [
      'amount',
      'publishedAt',
    ]);

    expect(allowed.get('amount')?.type).toBe('number');
  });

  it('names every member that is missing, and the flag it lacks', () => {
    expect(() =>
      assertQueryable(PublishedOffering, 'filterable', [
        'name',
        'description',
        'media',
      ]),
    ).toThrow(
      'PublishedOffering: description, media must be declared filterable',
    );
  });
});
