import { describe, expect, it } from 'vitest';

import { SALES_NAV } from './nav.js';

describe('the sales navigation', () => {
  it('contributes two tiers, because the two screens are two kinds of screen', () => {
    // The sidebar groups by type, so a till under Definiciones would tell the
    // reader that selling is a kind of configuration (ADR 0033).
    expect(SALES_NAV.map(section => section.type)).toEqual([
      'master',
      'wizard',
    ]);
  });

  it('derives every channel item from the surface that declares it', () => {
    const [channels] = SALES_NAV;

    expect(channels?.items).toEqual([
      {
        label: 'shell:sales.nav.channels',
        href: '/sales/sales-channel',
        icon: '⌗',
        workspace: 'master:sales-channel',
        permission: 'sales-management:sales-channel:read',
        entitled: true,
      },
    ]);
  });

  it('guards the till with the verb rather than with a read', () => {
    // Seeing which counters exist and being allowed to take money through one
    // are different authorities — which is the whole reason the verb exists.
    const [, guided] = SALES_NAV;

    expect(guided?.items[0]?.permission).toBe(
      'sales-management:sales-channel:sell',
    );
    expect(guided?.items[0]?.workspace).toBe('wizard:counter-sale');
  });

  it('gates both on the organization`s provisioning', () => {
    // Tenant-plane and vendor-owned, so ADR 0007's second ceiling applies: an
    // organization provisioned for nothing sees neither.
    for (const section of SALES_NAV) {
      for (const item of section.items) {
        expect(item.entitled).toBe(true);
      }
    }
  });
});
