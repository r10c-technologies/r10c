/**
 * The service as a *composable definition*, separate from `main.ts` which boots
 * it. `main.ts` stays the webpack entry point; this barrel is what lets the e2e
 * `mock` profile launch the SAME router in-process against driver fakes, rather
 * than re-declaring a stand-in that could drift from the real route surface.
 */
export { makeMongoAccountRepository } from './identity/account-repository';
export {
  LOCK_TTL_SECONDS,
  makeRedisAttemptLimiter,
  MAX_ATTEMPTS_PER_SOURCE,
  MAX_FAILING_SOURCES,
} from './identity/attempt-limiter';
export {
  makeDevNotificationPort,
  OUTBOX_COLLECTION,
} from './identity/notifications';
export { makeBcryptPasswordHasher } from './identity/password';
export { makeRedisIdentityProvider } from './identity/redis-identity-provider';
export {
  DEV_SEED_PASSWORD,
  JWT_AUDIENCE,
  JWT_ISSUER,
} from './identity/session-policy';
export { makeStubIdentityProvider } from './identity/stub-identity-provider';
export {
  DEVICE_COLLECTION,
  makeMongoUserDeviceRepository,
} from './identity/user-device-repository';
export {
  entityIdentifierSeedData,
  userIdentitySeedData,
} from './identity/user-seed-data';
export { AppLayer, seedCredentials } from './mongo';
export { router } from './routes';

export const SERVICE_NAME = '@r10c/auth-service';

/** The `310N` convention: auth is domain index 2. */
export const DEFAULT_PORT = 3102;
