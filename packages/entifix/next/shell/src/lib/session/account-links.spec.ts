import { describe, expect, it } from 'vitest';

import { ACCOUNT_DESTINATIONS, accountPaths } from './account-links';

describe('account links', () => {
  // The keys are `shell`-namespaced (`account.*`), not `app:auth.*`: this list
  // is shell-owned, so the module that authors the string resolves it.
  it('prefixes in-app paths with the locale', () => {
    expect(accountPaths('en')).toContainEqual({
      labelKey: 'account.profile',
      href: '/en/account',
    });
    expect(accountPaths('en')).toContainEqual({
      labelKey: 'account.sessions',
      href: '/en/account/sessions',
    });
  });

  it('covers every destination', () => {
    expect(accountPaths('es')).toHaveLength(ACCOUNT_DESTINATIONS.length);
  });
});
