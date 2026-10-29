import { dryRun } from '@entifix/business';
import { verifiedContext } from '@entifix/business/verified';
import type { Entity, EntityId } from '@entifix/core';
import { describe, expect, it } from 'vitest';

import { settlementNarrowing, type VendorScoped } from './settlement-narrowing.js';

type Ledger = Entity & VendorScoped & { id: EntityId };

const rules = settlementNarrowing<Ledger>();

const narrowingOf = (facts: {
  partyRole?: string;
  organizationId?: string;
}) => {
  const context = verifiedContext({
    entitlements: [],
    roles: [],
    flags: [],
    config: {},
    ...facts,
  });
  const chosen = dryRun(rules, context);
  return chosen === undefined
    ? 'nothing'
    : rules[chosen.rule]?.variant.impl(context);
};

describe('settlementNarrowing', () => {
  it('leaves platform staff unscoped', () => {
    expect(narrowingOf({ partyRole: 'operator' })).toBe('unscoped');
  });

  it('narrows a vendor to their own records', () => {
    expect(
      narrowingOf({ partyRole: 'vendor', organizationId: 'org-1' }),
    ).toEqual({
      operator: 'and',
      values: [{ property: 'vendorId', operator: 'eq', value: 'org-1' }],
    });
  });

  it('shows everybody else nothing', () => {
    expect(narrowingOf({ partyRole: 'vendor' })).toBe('nothing');
    expect(
      narrowingOf({ partyRole: 'customer', organizationId: 'org-1' }),
    ).toBe('nothing');
  });
});
