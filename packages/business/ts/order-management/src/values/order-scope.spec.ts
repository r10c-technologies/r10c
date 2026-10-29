import { dryRun } from '@entifix/business';
import { verifiedContext } from '@entifix/business/verified';
import { describe, expect, it } from 'vitest';

import {
  orderNarrowing,
  orderScopeFor,
  type ScopedCaller,
} from './order-scope.js';

const principal = (overrides: Partial<ScopedCaller> = {}): ScopedCaller => ({
  ...overrides,
});

describe('the scope a principal reads orders in', () => {
  it('leaves an operator unscoped', () => {
    expect(orderScopeFor(principal({ partyRole: 'operator' }))).toEqual({
      kind: 'unscoped',
    });
  });

  it('scopes a vendor to the organization their session acts for', () => {
    const scope = orderScopeFor(
      principal({ partyRole: 'vendor', organizationId: 'org-1' }),
    );

    expect(scope).toEqual({ kind: 'vendor', organizationId: 'org-1' });
  });

  it('scopes everybody else to the party they are', () => {
    const scope = orderScopeFor(
      principal({ partyRole: 'customer', partyId: 'party-user-2' }),
    );

    expect(scope).toEqual({ kind: 'buyer', partyId: 'party-user-2' });
  });

  /**
   * ⚠️ The direction to be wrong in. A session whose own records cannot be
   * identified reads nothing; falling back to `unscoped` would turn a missing
   * claim into every buyer's receipts.
   */
  it('reads nothing for a vendor session with no organization', () => {
    expect(orderScopeFor(principal({ partyRole: 'vendor' }))).toEqual({
      kind: 'nothing',
    });
  });

  it('reads nothing for an account with no party', () => {
    expect(orderScopeFor(principal({ partyRole: 'customer' }))).toEqual({
      kind: 'nothing',
    });
  });

  it('reads nothing for a session predating the party claim', () => {
    // No `partyRole` at all — a token minted before it was carried. It falls to
    // the buyer branch, holds no party, and so sees nothing.
    expect(orderScopeFor(principal())).toEqual({ kind: 'nothing' });
  });
});

const narrowingOf = (facts: {
  partyRole?: string;
  organizationId?: string;
  partyId?: string;
}) => {
  const context = verifiedContext({
    entitlements: [],
    roles: [],
    flags: [],
    config: {},
    ...facts,
  });
  const chosen = dryRun(orderNarrowing, context);
  return chosen === undefined
    ? 'nothing'
    : orderNarrowing[chosen.rule]?.variant.impl(context);
};

describe('the narrowing a caller reads orders under', () => {
  it('leaves platform staff unscoped', () => {
    expect(narrowingOf({ partyRole: 'operator' })).toBe('unscoped');
  });

  it('narrows a vendor to the orders that owe them a line', () => {
    expect(
      narrowingOf({ partyRole: 'vendor', organizationId: 'org-2' }),
    ).toEqual({
      operator: 'and',
      values: [{ property: 'items.vendorId', operator: 'eq', value: 'org-2' }],
    });
  });

  it('narrows a buyer to the orders they placed', () => {
    expect(narrowingOf({ partyRole: 'customer', partyId: 'party-1' })).toEqual({
      operator: 'and',
      values: [{ property: 'buyerId', operator: 'eq', value: 'party-1' }],
    });
  });

  // A vendor session with no organization is not a buyer either.
  it('shows nothing to a caller no rule fits', () => {
    expect(narrowingOf({ partyRole: 'vendor', partyId: 'party-1' })).toBe(
      'nothing',
    );
    expect(narrowingOf({})).toBe('nothing');
  });
});
