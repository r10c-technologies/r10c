import { describe, expect, it } from 'vitest';

import { FULFILMENT_SURFACES } from './fulfilment-surfaces';
import { FULFILMENT_NAV } from './nav';

describe('FULFILMENT_NAV', () => {
  it('contributes one section, in the shape every other shell uses', () => {
    expect(FULFILMENT_NAV).toHaveLength(1);
    expect(FULFILMENT_NAV[0].title).toBe('r10c:fulfilment.nav.title');
  });

  // Contributing the type is the whole of what renders the tier; a section
  // that forgot it would sort beside the account surface (ADR 0033).
  it('declares itself as Operaciones', () => {
    expect(FULFILMENT_NAV[0].type).toBe('operation');
  });

  it('derives an item per surface, in surface order', () => {
    expect(FULFILMENT_NAV[0].items.map(item => item.href)).toEqual(
      FULFILMENT_SURFACES.map(surface => surface.basePath),
    );
    expect(FULFILMENT_NAV[0].items.map(item => item.label)).toEqual(
      FULFILMENT_SURFACES.map(surface => surface.navLabelKey),
    );
  });

  it('carries the permission derived from the entity’s own decorator', () => {
    expect(FULFILMENT_NAV[0].items.map(item => item.permission)).toEqual([
      'shipping-order-management:shipping-order:read',
    ]);
  });

  it('offers each item in the workspace under the operation type', () => {
    expect(FULFILMENT_NAV[0].items.map(item => item.workspace)).toEqual([
      'operation:shipping-order',
    ]);
  });

  // ADR 0037: an organization not provisioned for fulfilment sees no item. An
  // `entitled` item with no `permission` is a declaration error the host
  // throws on, since there would be no domain to read the entitlement from.
  it('gates every item on the organization’s provisioning', () => {
    for (const item of FULFILMENT_NAV[0].items) {
      expect(item.entitled).toBe(true);
      expect(item.permission).toBeDefined();
      expect(item.icon).toBeTruthy();
    }
  });
});
