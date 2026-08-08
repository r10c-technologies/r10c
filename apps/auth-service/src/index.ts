/**
 * The service as a *composable definition*, separate from `main.ts` which boots
 * it. `main.ts` stays the webpack entry point; this barrel is what lets the e2e
 * `mock` profile launch the SAME router in-process against driver fakes, rather
 * than re-declaring a stand-in that could drift from the real route surface.
 */
export { makeMongoAccountRepository } from './identity/account-repository';
export {
  IdTokenStoreLayer,
  IdTokenStoreTag,
  makeRedisIdTokenStore,
} from './identity/id-token-store';
export {
  makeDevNotificationPort,
  OUTBOX_COLLECTION,
} from './identity/notifications';
export {
  makeRedisProviderSessionIndex,
  ProviderSessionIndexLayer,
  ProviderSessionIndexTag,
} from './identity/provider-session-index';
export {
  PROVIDER,
  provisionZitadelHuman,
  resolveSignIn,
} from './identity/provisioning';
export { makeRedisIdentityProvider } from './identity/redis-identity-provider';
export {
  DEV_SEED_PASSWORD,
  JWT_AUDIENCE,
  JWT_ISSUER,
  OIDC_STATE_TTL_SECONDS,
} from './identity/session-policy';
export {
  makeMongoSessionScopeResolver,
  SessionScopeResolverTag,
} from './identity/session-scope';
export { makeStubIdentityProvider } from './identity/stub-identity-provider';
export {
  individualSeedData,
  membershipSeedData,
} from './identity/tenancy-seed-data';
export {
  DEVICE_COLLECTION,
  makeMongoUserDeviceRepository,
} from './identity/user-device-repository';
export {
  entityIdentifierSeedData,
  userIdentitySeedData,
} from './identity/user-seed-data';
export { AppLayer, seedIdentityProvider } from './mongo';
export { router } from './routes';

export const SERVICE_NAME = '@r10c/auth-service';

/** The `310N` convention: auth is domain index 2. */
export const DEFAULT_PORT = 3102;
