import {
  entityIdentifierSeedData,
  makeStubIdentityProvider,
  router,
  SERVICE_NAME,
  userIdentitySeedData,
} from '@r10c/auth-service';
import { IdentityProviderTag } from '@r10c/business-ts-authn';
import {
  fakeConfigurationLayer,
  fakeMongoLayer,
} from '@r10c/entifix-ts-testing-e2e/fixtures';
import {
  LoadedConfigurationTag,
  type RunningTestService,
  serveTestService,
} from '@r10c/shells-effect-service';
import { Layer } from 'effect';

/** What the service would otherwise fetch from config-service at boot. */
const CONFIGURATION = {
  mongo: [
    { key: 'uri', value: 'mongodb://mock/auth' },
    { key: 'db', value: 'auth' },
  ],
};

/**
 * The `mock` composition root: the same shape as the service's own `AppLayer`
 * (`apps/auth-service/src/mongo.ts`), with the Mongo *connection* replaced by a
 * driver fake and the config-service fetch replaced by a literal.
 *
 * The seed is applied directly rather than through the service's `seedUsers`,
 * because a pre-seeded fake and a seeded collection are the same thing here and
 * this keeps the collections named at the call site. The configuration store
 * and the stub identity provider are the real ones.
 */
const MockAppLayer = Layer.mergeAll(
  fakeMongoLayer({
    'user-identity': userIdentitySeedData,
    'entity-identifier': entityIdentifierSeedData,
  }).layer,
  fakeConfigurationLayer(CONFIGURATION),
  Layer.succeed(LoadedConfigurationTag, CONFIGURATION),
  Layer.succeed(IdentityProviderTag, makeStubIdentityProvider()),
);

/** Boots the service's real router in-process, on an ephemeral port. */
export const startMockService = (): Promise<RunningTestService> =>
  serveTestService({
    name: SERVICE_NAME,
    port: 0,
    router,
    appLayer: MockAppLayer,
  });
