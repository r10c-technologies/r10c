import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_DESTINATIONS,
  accountPaths,
  accountUrls,
} from './account-links';

describe('account links', () => {
  it('prefixes in-app paths with the locale', () => {
    expect(accountPaths('en')).toContainEqual({
      labelKey: 'auth.account.profile',
      href: '/en/account',
    });
    expect(accountPaths('en')).toContainEqual({
      labelKey: 'auth.sessions.nav',
      href: '/en/account/sessions',
    });
  });

  it('bakes the locale into cross-app urls', () => {
    // `localeHref` leaves absolute URLs alone, so nothing downstream adds this
    // prefix — omit it and an English reader lands back in Spanish.
    expect(accountUrls('http://localhost:3002', 'en')).toContainEqual({
      labelKey: 'auth.account.profile',
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
