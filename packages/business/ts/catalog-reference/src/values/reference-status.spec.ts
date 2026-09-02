import { describe, expect, it } from 'vitest';

import {
  DEFAULT_REFERENCE_STATUS,
  isReferenceStatus,
  ReferenceStatuses,
} from './reference-status.js';

describe('reference status', () => {
  it('offers exactly the two states the lifecycle has', () => {
    expect(ReferenceStatuses).toEqual(['active', 'retired']);
  });

  /** A newly authored record is offered for classification straight away. */
  it('starts active', () => {
    expect(DEFAULT_REFERENCE_STATUS).toBe('active');
  });

  it.each([...ReferenceStatuses])('narrows %s', status => {
    expect(isReferenceStatus(status)).toBe(true);
  });

  it.each([['deleted'], [''], [null], [undefined], [1], [{}]])(
    'refuses %p',
    value => {
      expect(isReferenceStatus(value)).toBe(false);
    },
  );
});
