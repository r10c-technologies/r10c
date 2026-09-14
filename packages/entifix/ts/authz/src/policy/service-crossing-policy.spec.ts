import { describe, expect, it } from 'vitest';

import type { Permission } from '../values/permission.js';
import {
  makeStaticServiceCrossingPolicy,
  NoServiceCrossings,
} from './service-crossing-policy.js';

const ALLOWED: readonly Permission[] = [
  'stock:reservation:write',
  'order:product-order:write',
];

describe('makeStaticServiceCrossingPolicy', () => {
  const policy = makeStaticServiceCrossingPolicy(ALLOWED);

  it('allows a permission on the list', () => {
    expect(policy.allows('stock:reservation:write')).toBe(true);
  });

  it('denies a neighbouring verb on the same entity', () => {
    expect(policy.allows('stock:reservation:release')).toBe(false);
  });

  it('denies an entity the list never names', () => {
    expect(policy.allows('stock:stock-movement:write')).toBe(false);
  });

  it('matches by the same rule as a session grant, not by string equality', () => {
    // `permissionMatches` is what expands a wildcard, and it is used here so a
    // required permission is matched identically everywhere in the system.
    // What differs between this and `can` is only which list is consulted.
    expect(
      makeStaticServiceCrossingPolicy(['stock:*:write']).allows(
        'stock:reservation:write',
      ),
    ).toBe(true);
  });

  it('allows nothing when the list is empty', () => {
    expect(
      makeStaticServiceCrossingPolicy([]).allows('stock:reservation:write'),
    ).toBe(false);
  });
});

describe('NoServiceCrossings', () => {
  it('refuses everything, so an application with no sagas can say so', () => {
    expect(NoServiceCrossings.allows('stock:reservation:write')).toBe(false);
    expect(NoServiceCrossings.allows('anything:at:all')).toBe(false);
  });
});
