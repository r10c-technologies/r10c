import { describe, expect, it } from 'vitest';

import { navFor } from './nav';

/** Echo the key back, so a test asserts on keys rather than on translations. */
const echo = (key: string) => key;

describe('navFor', () => {
  it('hides an item the caller has no permission for', () => {
    const sections = navFor([], echo);

    expect(
      sections.flatMap(section => section.items.map(item => item.href)),
    ).not.toContain('/users');
  });

  it('shows the item once the permission is granted', () => {
    const sections = navFor(['admin'], echo);

    expect(
      sections.flatMap(section => section.items.map(item => item.href)),
    ).toContain('/users');
  });

  it('drops a section left with no items', () => {
    // The identity section holds only the guarded entry, so a plain user must
    // not be shown an empty heading where the users link would have been.
    const titles = navFor([], echo).map(section => section.title);

    expect(titles).not.toContain('shell:auth.nav.identity');
  });

  it('shows every account destination to any signed-in caller', () => {
    // Your own account is not an administrative screen. A plain `user` has to
    // reach all three, which is why none of them carries a permission.
    const withoutRoles = navFor([], echo);
    const account = withoutRoles.find(
      section => section.title === 'shell:auth.nav.accountSection',
    );

    expect(account?.items.map(item => item.href)).toEqual([
      '/account',
      '/account/security',
      '/account/sessions',
    ]);
  });

  it('translates through the function it is given', () => {
    // The table holds catalog keys, not copy: this runs in a server layout
    // rather than a component, so the translator is passed in.
    const sections = navFor(['admin'], key => `translated:${key}`);

    expect(sections[0]?.title).toBe('translated:shell:auth.nav.identity');
  });
});
