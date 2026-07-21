/**
 * The service as a *composable definition*, separate from `main.ts` which boots
 * it. `main.ts` stays the webpack entry point; this barrel is what lets the e2e
 * `mock` profile launch the SAME router in-process against driver fakes, rather
 * than re-declaring a stand-in that could drift from the real route surface.
 */
export { makeStubIdentityProvider } from './identity/stub-identity-provider';
export {
  entityIdentifierSeedData,
  userIdentitySeedData,
} from './identity/user-seed-data';
export { AppLayer } from './mongo';
export { router } from './routes';

export const SERVICE_NAME = '@r10c/auth-service';

/** The `310N` convention: auth is domain index 2. */
export const DEFAULT_PORT = 3102;
