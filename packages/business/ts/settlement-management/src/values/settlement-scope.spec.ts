import { describe, expect, it } from 'vitest';

import {
  settlementInScope,
  settlementScopeFilter,
  settlementScopeFor,
} from './settlement-scope.js';

describe('the settlement scope', () => {
  it('gives an operator everything, a vendor their own, and anybody else nothing', () => {
    expect(settlementScopeFor({ partyRole: 'operator' })).toEqual({
      kind: 'unscoped',
    });
    expect(
      settlementScopeFor({ partyRole: 'vendor', organizationId: 'v-1' }),
    ).toEqual({
      kind: 'vendor',
      vendorId: 'v-1',
    });
    expect(settlementScopeFor({ partyRole: 'vendor' })).toEqual({
      kind: 'nothing',
    });
    expect(settlementScopeFor({ partyRole: 'customer' })).toEqual({
      kind: 'nothing',
    });
  });

  it('narrows a vendor’s reads to their own records, and nobody else’s', () => {
    const vendor = { kind: 'vendor', vendorId: 'v-1' } as const;

    expect(settlementScopeFilter(vendor)).toEqual({
      operator: 'and',
      values: [{ property: 'vendorId', operator: 'eq', value: 'v-1' }],
    });
    expect(settlementScopeFilter({ kind: 'unscoped' })).toBeUndefined();
    expect(settlementInScope(vendor, { vendorId: 'v-1' })).toBe(true);
    expect(settlementInScope(vendor, { vendorId: 'v-2' })).toBe(false);
    expect(settlementInScope({ kind: 'unscoped' }, { vendorId: 'v-2' })).toBe(
      true,
    );
    expect(settlementInScope({ kind: 'nothing' }, { vendorId: 'v-1' })).toBe(
      false,
    );
  });
});
