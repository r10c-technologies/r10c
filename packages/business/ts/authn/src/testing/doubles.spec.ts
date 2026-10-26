import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { describeAccountRepositoryContract } from './account-repository.contract.js';
import {
  describeOidcProviderContract,
  describeProviderDirectoryContract,
  describeProviderEventVerifierContract,
  describePublicKeySetContract,
} from './identity-provider-ports.contract.js';
import {
  makeInMemoryAccountRepository,
  makeInMemoryNotificationPort,
  makeInMemoryUserDeviceRepository,
} from './in-memory-accounts.js';
import {
  makeInMemoryProviderDirectory,
  makeInMemoryProviderEvents,
  makeScriptedOidcProvider,
  makeStaticPublicKeySet,
} from './in-memory-provider.js';
import { makeInMemorySessionScopeResolver } from './in-memory-session-scope-resolver.js';
import {
  makeInMemoryIdTokenStore,
  makeInMemoryLifecycleCursor,
  makeInMemoryProviderSessionIndex,
} from './in-memory-session-stores.js';
import { describeNotificationPortContract } from './notification-port.contract.js';
import { describeSessionScopeResolverContract } from './session-scope-resolver.contract.js';
import {
  describeIdTokenStoreContract,
  describeLifecycleCursorContract,
  describeProviderSessionIndexContract,
} from './session-stores.contract.js';
import { describeUserDeviceRepositoryContract } from './user-device-repository.contract.js';

describeAccountRepositoryContract(
  'the in-memory accounts',
  makeInMemoryAccountRepository,
);
describeUserDeviceRepositoryContract(
  'the in-memory devices',
  makeInMemoryUserDeviceRepository,
);
describeNotificationPortContract(
  'the in-memory notices',
  makeInMemoryNotificationPort,
);
describeSessionScopeResolverContract(
  'the in-memory resolver',
  makeInMemorySessionScopeResolver,
);
describeIdTokenStoreContract('the in-memory id tokens', makeInMemoryIdTokenStore);
describeProviderSessionIndexContract(
  'the in-memory provider sessions',
  makeInMemoryProviderSessionIndex,
);
describeLifecycleCursorContract('the in-memory cursor', () =>
  makeInMemoryLifecycleCursor(),
);
describeOidcProviderContract('the scripted provider', () =>
  makeScriptedOidcProvider(),
);
describeProviderEventVerifierContract(
  'the in-memory provider events',
  () => makeInMemoryProviderEvents(),
);
describeProviderDirectoryContract(
  'the in-memory directory',
  makeInMemoryProviderDirectory,
);
describePublicKeySetContract('the static key set', () =>
  makeStaticPublicKeySet(),
);

describe('the scripted provider beyond the contract', () => {
  it('answers the identity and the logout it was scripted with', async () => {
    const provider = makeScriptedOidcProvider({
      identities: {
        'code-1': { subject: 'sub-1', emailVerified: false, idToken: 't' },
      },
      logouts: { 'logout-1': { subject: 'sub-1' } },
    });

    expect(
      await Effect.runPromise(
        provider.exchangeCode({ code: 'code-1', codeVerifier: 'v', nonce: 'n' }),
      ),
    ).toMatchObject({ subject: 'sub-1' });
    expect(
      await Effect.runPromise(provider.verifyLogoutToken('logout-1')),
    ).toEqual({ subject: 'sub-1' });
  });
});
