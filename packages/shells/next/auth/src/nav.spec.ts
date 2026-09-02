import { describe, expect, it } from 'vitest';

import { AUTH_NAV } from './nav.js';

describe('AUTH_NAV', () => {
  it('guards user administration with the entity-derived permission', () => {
    const users = AUTH_NAV.flatMap(section => section.items).find(
      item => item.href === '/users',
    );

    expect(users?.permission).toBe('authn:user-identity:read');
  });

  it('leaves every account destination unguarded', () => {
    // Your own account is not an administrative screen. A plain `user` must
    // reach all three, which is why none of them carries a permission.
    const account = AUTH_NAV.find(
      section => section.title === 'shell:auth.nav.accountSection',
    );

    expect(account?.items.map(item => item.href)).toEqual([
      '/account',
      '/account/security',
      '/account/sessions',
    ]);
    expect(account?.items.every(item => item.permission === undefined)).toBe(
      true,
    );
  });

  it('types the identity section and leaves the account surface untyped', () => {
    // ADR 0033. `Cuenta` is the one section entitled to no type: it is the
    // signed-in person's own account, not a group of administrative screens —
    // the same reason none of its items carries a permission.
    const byTitle = new Map(
      AUTH_NAV.map(section => [section.title, section.type]),
    );

    expect(byTitle.get('shell:auth.nav.identity')).toBe('master');
    expect(byTitle.get('shell:auth.nav.accountSection')).toBeUndefined();
  });

  it('names copy in the shared shell namespace', () => {
    // An `app:` key is lint-restricted to `apps/`, so a shell binding one would
    // fail the build — and a second host would have to re-translate.
    const keys = AUTH_NAV.flatMap(section => [
      section.title,
      ...section.items.map(item => item.label),
    ]);

    expect(keys.every(key => key?.startsWith('shell:') === true)).toBe(true);
  });
});
