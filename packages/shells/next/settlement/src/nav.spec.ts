import { describe, expect, it } from 'vitest';

import { SETTLEMENT_NAV } from './nav';
import {
  permissionForSettlementSurface,
  SETTLEMENT_MASTER_SURFACES,
  SETTLEMENT_OPERATION_SURFACES,
  settlementListAddress,
} from './settlement-surfaces';

describe('SETTLEMENT_NAV', () => {
  /**
   * ⚠️ **Two sections, where every other shell contributes one.** This domain
   * spans two tiers, and each section's heading comes from
   * `SCREEN_TYPE_LABEL_KEYS` — so contributing both is the whole of what makes
   * them appear, and `groupByScreenType` merges them with every other shell's
   * sections of the same type. A section that forgot its `type` would sort last,
   * beside the account surface, which is the one section deliberately outside
   * the taxonomy (ADR 0033).
   */
  it('contributes one section per tier, in the shape every shell uses', () => {
    expect(SETTLEMENT_NAV).toHaveLength(2);
    expect(SETTLEMENT_NAV.map(section => section.type)).toEqual([
      'master',
      'operation',
    ]);
    for (const section of SETTLEMENT_NAV) {
      expect(section.title).toBe('shell:settlement.nav.settlement');
    }
  });

  it('derives an item per surface, in surface order', () => {
    expect(SETTLEMENT_NAV[0]?.items.map(item => item.href)).toEqual(
      SETTLEMENT_MASTER_SURFACES.map(surface => surface.basePath),
    );
    expect(SETTLEMENT_NAV[1]?.items.map(item => item.href)).toEqual(
      SETTLEMENT_OPERATION_SURFACES.map(surface => surface.basePath),
    );
  });

  it('guards each item with the permission its entity derives', () => {
    const items = SETTLEMENT_NAV.flatMap(section => section.items);
    const surfaces = [
      ...SETTLEMENT_MASTER_SURFACES,
      ...SETTLEMENT_OPERATION_SURFACES,
    ];

    expect(items.map(item => item.permission)).toEqual(
      surfaces.map(permissionForSettlementSurface),
    );
  });

  it('addresses each item’s workspace tab under its own tier', () => {
    const items = SETTLEMENT_NAV.flatMap(section => section.items);
    const surfaces = [
      ...SETTLEMENT_MASTER_SURFACES,
      ...SETTLEMENT_OPERATION_SURFACES,
    ];

    expect(items.map(item => item.workspace)).toEqual(
      surfaces.map(settlementListAddress),
    );
  });

  /**
   * ⚠️ **Entitlement-gated, and the omission is the failure worth remembering.**
   * The stock surface shipped with every route answering and every grant held,
   * and showed no section at all, because ADR 0007's second ceiling is the
   * organization's provisioning and it is independent of the grant table.
   */
  it('gates every item on the organization’s provisioning', () => {
    for (const item of SETTLEMENT_NAV.flatMap(section => section.items)) {
      expect(item.entitled).toBe(true);
    }
  });

  it('names its copy in the shell namespace', () => {
    // `app:` keys are a lint error outside `apps/` — copy an app authors reaches
    // a shell as a resolved string, never as a key.
    for (const item of SETTLEMENT_NAV.flatMap(section => section.items)) {
      expect(item.label.startsWith('shell:settlement.nav.')).toBe(true);
    }
  });
});
