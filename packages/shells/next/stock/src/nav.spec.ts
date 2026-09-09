import { describe, expect, it } from 'vitest';

import { STOCK_NAV } from './nav';
import { STOCK_SURFACES } from './stock-surfaces';

describe('STOCK_NAV', () => {
  it('contributes one section, in the same shape every other shell uses', () => {
    // A host concatenates these rather than special-casing any of them, so a
    // fragment that carried a different shape would need an edit in the host.
    expect(STOCK_NAV).toHaveLength(1);
    expect(STOCK_NAV[0].title).toBe('shell:stock.nav.stock');
  });

  /**
   * ⚠️ **Operaciones, and contributing the type is the whole of what renders
   * the tier.** The heading comes from `SCREEN_TYPE_LABEL_KEYS`, so the sidebar
   * needed no change to grow a second tier — and a section that forgot its
   * `type` would sort last, beside the account surface, which is the one
   * section deliberately outside the taxonomy (ADR 0033).
   */
  it('declares itself as Operaciones', () => {
    expect(STOCK_NAV[0].type).toBe('operation');
  });

  it('derives an item per surface, in surface order', () => {
    expect(STOCK_NAV[0].items.map(item => item.href)).toEqual(
      STOCK_SURFACES.map(surface => surface.basePath),
    );
    expect(STOCK_NAV[0].items.map(item => item.label)).toEqual(
      STOCK_SURFACES.map(surface => surface.navLabelKey),
    );
  });

  it('carries the permission derived from each entity’s own decorator', () => {
    expect(STOCK_NAV[0].items.map(item => item.permission)).toEqual([
      'stock-management:stock-item:read',
      'stock-management:stock-movement:read',
      'stock-management:reservation:read',
    ]);
  });

  it('offers each item in the workspace under the operation type', () => {
    expect(STOCK_NAV[0].items.map(item => item.workspace)).toEqual([
      'operation:stock-item',
      'operation:stock-movement',
      'operation:reservation',
    ]);
  });

  /**
   * ⚠️ Every item is entitlement-gated, and the omission of this flag is what
   * a live pass caught: stock is tenant-plane and vendor-owned, so it sits
   * under ADR 0007's second ceiling — an organization not provisioned for
   * `stock-management` sees no section at all, with no error and no empty
   * state. That is correct, and it is why the demo organization's entitlement
   * had to name the domain.
   *
   * `catalog-reference` is the contrast: operator-owned platform vocabulary
   * every vendor shares, never grantable, and therefore never gated.
   */
  it('gates every item on the organization’s provisioning', () => {
    for (const item of STOCK_NAV[0].items) {
      expect(item.entitled).toBe(true);
      // Setting `entitled` without a `permission` is a declaration error the
      // host throws on, because there would be no domain segment to read.
      expect(item.permission).toBeDefined();
    }
  });

  it('gives every item an icon', () => {
    for (const item of STOCK_NAV[0].items) {
      expect(item.icon).toBeTruthy();
    }
  });
});
