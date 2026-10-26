/**
 * The service as a *composable definition*, separate from `main.ts` which boots
 * it. `main.ts` stays the webpack entry point; this barrel is what lets the e2e
 * `mock` profile launch the SAME router in-process against driver fakes, rather
 * than re-declaring a stand-in that could drift from the real route surface.
 */
export {
  PROVIDER,
  provisionZitadelHuman,
  resolveSignIn,
} from './identity/provisioning';
export {
  DEV_SEED_PASSWORD,
  JWT_AUDIENCE,
  JWT_ISSUER,
  OIDC_STATE_TTL_SECONDS,
} from './identity/session-policy';
export {
  individualSeedData,
  membershipSeedData,
  partyRoleSeedData,
} from './identity/tenancy-seed-data';
export {
  entityIdentifierSeedData,
  userIdentitySeedData,
} from './identity/user-seed-data';
export { AppLayer, seedIdentityProvider } from './mongo';
export { router } from './routes';
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
