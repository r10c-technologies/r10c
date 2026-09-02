import { can } from '@r10c/business-ts-authz';
import { describe, expect, it } from 'vitest';

import { SYSTEM_MANAGEMENT_NAV } from './nav.js';

describe('SYSTEM_MANAGEMENT_NAV', () => {
  const items = SYSTEM_MANAGEMENT_NAV.flatMap(section => section.items);

  it('guards every item with the permission the entity derives', () => {
    // Derived, not written out, so it cannot drift from what config-service
    // enforces on the route behind it.
    expect(items.map(item => item.permission)).toEqual([
      'config:configuration:read',
    ]);
  });

  it('is visible to super-admin and to nobody else', () => {
    const permissions = items.flatMap(item =>
      item.permission === undefined ? [] : [item.permission],
    );

    expect(permissions).toHaveLength(items.length);
    for (const permission of permissions) {
      expect(can(['super-admin'], permission)).toBe(true);
      expect(can(['admin'], permission)).toBe(false);
      expect(can(['user'], permission)).toBe(false);
    }
  });

  it('declares itself Definiciones, with no exception made for it', () => {
    // ADR 0033: the operator authors the row, it has no lifecycle, and every
    // service references it. That it is opened rarely is a fact about
    // frequency, not about shape.
    expect(SYSTEM_MANAGEMENT_NAV.map(section => section.type)).toEqual([
      'master',
    ]);
  });

  it('keys its copy to the shared shell namespace, never an app catalog', () => {
    // An `app:` key would be lint-rejected outside `apps/`, and a second host
    // must not have to re-translate these screens.
    const keys = [
      ...SYSTEM_MANAGEMENT_NAV.map(section => section.title),
      ...items.map(item => item.label),
    ];
    for (const key of keys) {
      expect(key).toMatch(/^shell:/);
    }
  });
});
