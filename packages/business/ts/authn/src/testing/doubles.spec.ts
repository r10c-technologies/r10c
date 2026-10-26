import { describeAccountRepositoryContract } from './account-repository.contract.js';
import {
  makeInMemoryAccountRepository,
  makeInMemoryNotificationPort,
  makeInMemoryUserDeviceRepository,
} from './in-memory-accounts.js';
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
