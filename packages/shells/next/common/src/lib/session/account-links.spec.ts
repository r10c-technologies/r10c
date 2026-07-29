import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_DESTINATIONS,
  accountPaths,
  accountUrls,
} from './account-links';

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

  it('bakes the locale into cross-app urls', () => {
    // `localeHref` leaves absolute URLs alone, so nothing downstream adds this
    // prefix — omit it and an English reader lands back in Spanish.
    expect(accountUrls('http://localhost:3002', 'en')).toContainEqual({
      labelKey: 'account.profile',
      href: 'http://localhost:3002/en/account',
    });
  });

  it('covers every destination in both forms', () => {
    expect(accountPaths('es')).toHaveLength(ACCOUNT_DESTINATIONS.length);
    expect(accountUrls('http://localhost:3002', 'es')).toHaveLength(
      ACCOUNT_DESTINATIONS.length,
    );
  });
});
