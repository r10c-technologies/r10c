import { describe, expect, it } from 'vitest';

import { AUTH_NAV } from './nav.js';

describe('AUTH_NAV', () => {
  it('guards user administration with the entity-derived permission', () => {
    const users = AUTH_NAV.flatMap(section => section.items).find(
      item => item.href === '/users',
    );

    expect(users?.permission).toBe('authn:user-identity:read');
  });

  it('addresses user administration as a workspace tab', () => {
    // It carried none until the pages grew the dual-host seam — `useParams`
    // resolves to nothing under `/workspace`, so an address without it opened a
    // form for a record with no id.
    const users = AUTH_NAV.flatMap(section => section.items).find(
      item => item.href === '/users',
    );

    expect(users?.workspace).toBe('master:user-identity');
  });

  it('gives no account destination a workspace address', () => {
    // Not an omission: `screenAddress` takes a `ScreenType`, and the account
    // section deliberately declares none (ADR 0033), so an address for it
    // cannot be constructed at all.
    const account = AUTH_NAV.find(
      section => section.title === 'r10c:auth.nav.accountSection',
    );

    expect(account?.items.every(item => item.workspace === undefined)).toBe(
      true,
    );
  });

  it('leaves every account destination unguarded', () => {
    // Your own account is not an administrative screen. A plain `user` must
    // reach all three, which is why none of them carries a permission.
    const account = AUTH_NAV.find(
      section => section.title === 'r10c:auth.nav.accountSection',
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

    expect(byTitle.get('r10c:auth.nav.identity')).toBe('master');
    expect(byTitle.get('r10c:auth.nav.accountSection')).toBeUndefined();
  });

  it("names copy in r10c's own screens namespace", () => {
    // An `app:` key is lint-restricted to `apps/`, so a shell binding one would
    // fail the build — and a second host would have to re-translate. And not
    // entifix's `shell`: since 0.5.0 that holds only the copy entifix renders.
    const keys = AUTH_NAV.flatMap(section => [
      section.title,
      ...section.items.map(item => item.label),
    ]);

    // The account destinations are entifix's own, and so is their copy — the
    // one `shell:account.*` exception, and nothing else of the framework's.
    expect(
      keys.every(
        key =>
          key?.startsWith('r10c:') === true ||
          key?.startsWith('shell:account.') === true,
      ),
    ).toBe(true);
    expect(keys.filter(key => key?.startsWith('r10c:'))).not.toEqual([]);
  });
});
