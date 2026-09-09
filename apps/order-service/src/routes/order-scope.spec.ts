import { OrderItem, ProductOrder } from '@r10c/business-ts-order-management';
import type { RequestPrincipal } from '@r10c/shells-effect-service';
import { describe, expect, it } from 'vitest';

import { orderInScope, orderScopeFilter, orderScopeFor } from './order-scope';

const principal = (
  overrides: Partial<RequestPrincipal> = {},
): RequestPrincipal => ({
  userId: 'user-2',
  subject: 'user-2',
  sessionId: 'sess-1',
  roles: ['user'],
  attributes: {},
  ...overrides,
});

const orderFor = (buyerId: string | undefined, vendorIds: string[]) => {
  const order = new ProductOrder(buyerId);
  order.items = vendorIds.map(vendorId => {
    const item = new OrderItem();
    item.vendorId = vendorId;
    return item;
  });
  return order;
};

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

describe('the predicate a scope becomes', () => {
  it('names the embedded vendor path for a vendor', () => {
    const filter = orderScopeFilter({ kind: 'vendor', organizationId: 'org-1' });

    expect(filter).toEqual({
      operator: 'and',
      values: [
        { property: 'items.vendorId', operator: 'eq', value: 'org-1' },
      ],
    });
  });

  it('names buyerId for a buyer', () => {
    const filter = orderScopeFilter({ kind: 'buyer', partyId: 'party-1' });

    expect(filter).toEqual({
      operator: 'and',
      values: [{ property: 'buyerId', operator: 'eq', value: 'party-1' }],
    });
  });

  it('adds no predicate for an operator', () => {
    expect(orderScopeFilter({ kind: 'unscoped' })).toBeUndefined();
  });

  it('adds no predicate for a caller who reads nothing', () => {
    // The route answers an empty page before this is ever consulted; the
    // `undefined` here is what makes a mistaken call harmless rather than an
    // unscoped read.
    expect(orderScopeFilter({ kind: 'nothing' })).toBeUndefined();
  });
});

describe('testing one loaded order against a scope', () => {
  const order = orderFor('party-user-2', ['org-1', 'org-2']);

  it('admits anything for an operator', () => {
    expect(orderInScope({ kind: 'unscoped' }, order)).toBe(true);
  });

  it('admits an order with a line for the vendor', () => {
    expect(
      orderInScope({ kind: 'vendor', organizationId: 'org-2' }, order),
    ).toBe(true);
  });

  it('refuses an order with no line for the vendor', () => {
    expect(
      orderInScope({ kind: 'vendor', organizationId: 'org-3' }, order),
    ).toBe(false);
  });

  it('admits the buyer their own order', () => {
    expect(orderInScope({ kind: 'buyer', partyId: 'party-user-2' }, order)).toBe(
      true,
    );
  });

  it('refuses another buyer, whatever id they hold', () => {
    expect(orderInScope({ kind: 'buyer', partyId: 'party-user-1' }, order)).toBe(
      false,
    );
  });

  it('refuses a counter sale with no buyer to a buyer', () => {
    // `buyerId` is optional (ADR 0024), and `undefined === undefined` would
    // otherwise hand every walk-in sale to any party with no id of its own.
    const walkIn = orderFor(undefined, ['org-1']);

    expect(orderInScope({ kind: 'buyer', partyId: 'party-user-2' }, walkIn)).toBe(
      false,
    );
  });

  it('refuses everything for a caller who reads nothing', () => {
    expect(orderInScope({ kind: 'nothing' }, order)).toBe(false);
  });
});
