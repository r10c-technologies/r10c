/**
 * The service as a *composable definition*, separate from `main.ts` which boots
 * it. `main.ts` stays the webpack entry point; this barrel is what lets the e2e
 * `mock` profile launch the SAME router in-process against driver fakes, rather
 * than re-declaring a stand-in that could drift from the real route surface.
 */
import { makeAppLayer } from '@r10c/shells-effect-auth';

import { seedAuth } from './seed';

export {
  individualSeedData,
  membershipSeedData,
  partyRoleSeedData,
} from './identity/tenancy-seed-data';
export {
  entityIdentifierSeedData,
  userIdentitySeedData,
} from './identity/user-seed-data';
export { seedAuth, seedIdentityProvider } from './seed';
export {
  AuthnHostLayer,
  DEV_SEED_PASSWORD,
  JWT_AUDIENCE,
  JWT_ISSUER,
  PROVIDER,
  router,
  ZitadelProviderPortsLayer,
} from '@r10c/shells-effect-auth';

/** The slice's composition, as the service mounts it, with its seed. */
export const AppLayer = makeAppLayer({ seed: seedAuth });
export {
  IdTokenStoreTag,
  makeSessionIdentityProvider,
  ProviderSessionIndexTag,
  SessionScopeResolverTag,
} from '@r10c/business-ts-authn';
export {
  DEVICE_COLLECTION,
  makeDevNotificationPort,
  makeMongoAccountRepository,
  makeMongoSessionScopeResolver,
  makeMongoUserDeviceRepository,
  OUTBOX_COLLECTION,
} from '@r10c/implementation-auth-mongo';
export {
  IdTokenStoreLayer,
  makeRedisIdTokenStore,
  makeRedisProviderSessionIndex,
  ProviderSessionIndexLayer,
} from '@r10c/implementation-session-redis';

export const SERVICE_NAME = '@r10c/auth-service';

/** The `310N` convention: auth is domain index 2. */
export const DEFAULT_PORT = 3102;
