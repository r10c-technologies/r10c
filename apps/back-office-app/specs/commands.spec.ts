import { NEW_COMMAND_PAGE } from '@r10c/business-ts-authz';

import { COMMANDS, visibleCommands } from '../src/lib/commands';
import type { NavPrincipal } from '../src/lib/nav-principal';

/**
 * Palette commands are gated by the same two ceilings navigation is — roles,
 * and what the acting organization was provisioned for (ADR 0007) — because
 * they run through `isNavItemVisible` itself rather than a second copy of it.
 *
 * Filtering here is presentation. The route behind the command is what refuses.
 */
const principal = (over: Partial<NavPrincipal> = {}): NavPrincipal => ({
  roles: ['super-admin'],
  organizationId: 'org-1',
  entitlements: ['product-configuration-management'],
  ...over,
});

const identity = (key: string) => key;
const keys = (principal: NavPrincipal): string[] =>
  visibleCommands(principal, identity).map(command => command.key);

describe('the back office command list', () => {
  it('concatenates every mounted shell’s contribution', () => {
    expect(COMMANDS.map(command => command.key)).toEqual([
      'new:product-specification',
      'new:product-brand',
      'new:product-category',
      'new:user-identity',
    ]);
  });

  it('puts every create command on the page the opener descends into', () => {
    expect(COMMANDS.every(command => command.page === NEW_COMMAND_PAGE)).toBe(
      true,
    );
  });

  it('names a write permission, never a read one — the command opens a form', () => {
    expect(COMMANDS.map(command => command.permission)).toEqual([
      'product-configuration-management:product-specification:write',
      'catalog-reference:product-brand:write',
      'catalog-reference:product-category:write',
      'authn:user-identity:write',
    ]);
  });
});

describe('visibleCommands', () => {
  it('offers a provisioned operator everything', () => {
    expect(keys(principal())).toHaveLength(COMMANDS.length);
  });

  it('refuses a role that holds no grant for the entity', () => {
    // `user` reads the catalog and writes nothing.
    expect(keys(principal({ roles: ['user'] }))).toEqual([]);
  });

  it('applies the entitlement ceiling to a tenant-plane command', () => {
    const entitled = keys(principal({ roles: ['admin'] }));
    const unprovisioned = keys(
      principal({ roles: ['admin'], entitlements: [] }),
    );

    expect(entitled).toContain('new:product-specification');
    expect(unprovisioned).not.toContain('new:product-specification');
  });

  it('leaves a session acting for no organization outside that ceiling', () => {
    // An operator holds no tenant scope, so the second ceiling does not apply to
    // them rather than emptying their palette.
    const operator = visibleCommands(
      { roles: ['super-admin'], entitlements: [] },
      identity,
    );

    expect(operator.map(c => c.key)).toContain('new:product-specification');
  });

  it('resolves the copy and splits the keywords the browser will match on', () => {
    const [first] = visibleCommands(principal(), key => `resolved:${key}`);

    expect(first.label).toBe(
      'resolved:entity:product-specification.form.newTitle',
    );
    // No command declares keywords today; the split still has to yield a list
    // rather than `undefined`, since the palette matches over it.
    expect(first.keywords).toEqual([]);
  });
});
