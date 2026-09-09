import { describe, expect, it } from 'vitest';

import { ORDER_NAV } from './nav';
import { ORDER_SURFACES } from './order-surfaces';

describe('ORDER_NAV', () => {
  it('contributes one section, in the same shape every other shell uses', () => {
    // A host concatenates these rather than special-casing any of them, so a
    // fragment that carried a different shape would need an edit in the host.
    expect(ORDER_NAV).toHaveLength(1);
    expect(ORDER_NAV[0].title).toBe('shell:order.nav.orders');
  });

  /**
   * ⚠️ **Operaciones, and contributing the type is the whole of what renders
   * the tier.** The heading comes from `SCREEN_TYPE_LABEL_KEYS`, so the sidebar
   * needed no change to grow a second tier — and a section that forgot its
   * `type` would sort last, beside the account surface, which is the one
   * section deliberately outside the taxonomy (ADR 0033).
   */
  it('declares itself as Operaciones', () => {
    expect(ORDER_NAV[0].type).toBe('operation');
  });

  it('derives an item per surface, in surface order', () => {
    expect(ORDER_NAV[0].items.map(item => item.href)).toEqual(
      ORDER_SURFACES.map(surface => surface.basePath),
    );
    expect(ORDER_NAV[0].items.map(item => item.label)).toEqual(
      ORDER_SURFACES.map(surface => surface.navLabelKey),
    );
  });

  it('carries the permission derived from each entity’s own decorator', () => {
    expect(ORDER_NAV[0].items.map(item => item.permission)).toEqual([
      'order-management:product-order:read',
    ]);
  });

  it('offers each item in the workspace under the operation type', () => {
    expect(ORDER_NAV[0].items.map(item => item.workspace)).toEqual([
      'operation:product-order',
    ]);
  });

  /**
   * ⚠️ Entitlement-gated, and the stock shell's history is why this assertion
   * exists rather than a comment: the flag's omission there meant a promoted
   * slice, a seeded service, every route answering — and no section in the
   * sidebar, with no error and no empty state, because ADR 0007's second
   * ceiling is the organization's provisioning. `order-management` had to join
   * the demo organization's entitlement for the same reason.
   *
   * `catalog-reference` is the contrast: operator-owned platform vocabulary
   * every vendor shares, never grantable, and therefore never gated.
   */
  it('gates every item on the organization’s provisioning', () => {
    for (const item of ORDER_NAV[0].items) {
      expect(item.entitled).toBe(true);
      // Setting `entitled` without a `permission` is a declaration error the
      // host throws on, because there would be no domain segment to read.
      expect(item.permission).toBeDefined();
    }
  });

  it('gives every item an icon', () => {
    for (const item of ORDER_NAV[0].items) {
      expect(item.icon).toBeTruthy();
    }
  });
});
