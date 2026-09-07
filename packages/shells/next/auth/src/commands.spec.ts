import { NEW_COMMAND_PAGE } from '@r10c/business-ts-authz';
import { describe, expect, it } from 'vitest';

import { AUTH_COMMANDS } from './commands';

describe('AUTH_COMMANDS', () => {
  it('contributes the one create route this shell serves', () => {
    expect(AUTH_COMMANDS).toEqual([
      {
        key: 'new:user-identity',
        labelKey: 'shell:auth.users.newTitle',
        href: '/users/new',
        page: NEW_COMMAND_PAGE,
        permission: 'authn:user-identity:write',
      },
    ]);
  });

  it('names `write`, because the command opens a form for a record that does not exist', () => {
    // Derived from `UserIdentity`'s own `@entity({ domain, key })`, so it cannot
    // drift from what auth-service enforces on `/users/new`. Offering it under
    // `read` would be an invitation to a `403`.
    expect(AUTH_COMMANDS[0]?.permission).toBe('authn:user-identity:write');
  });

  it('sits on the create page rather than the root', () => {
    // One row per creatable entity competing with the destinations they resemble
    // is exactly what the page stack exists to avoid.
    expect(AUTH_COMMANDS.every(c => c.page === NEW_COMMAND_PAGE)).toBe(true);
  });
});
