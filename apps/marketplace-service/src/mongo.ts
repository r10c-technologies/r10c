import {
  AUTH_TOKEN_AUDIENCE,
  AUTH_TOKEN_ISSUER,
} from '@r10c/business-ts-authn';
import {
  makeStaticPolicyDecision,
  PolicyDecisionTag,
} from '@r10c/business-ts-authz';
import {
  ConfigurationRepositoryTag,
  TokenServiceTag,
} from '@r10c/entifix-ts-business';
import { ConfigurationClientInMemory } from '@r10c/entifix-ts-core';
import { makeJoseTokenService } from '@r10c/entifix-ts-jwt-client';
import {
  MongoDatabaseLayer,
  MongoHealthProbeLayer,
} from '@r10c/entifix-ts-mongo-client';
import {
  LoadedConfigurationTag,
  loadRemoteConfiguration,
  observabilityFromConfiguration,
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';

import { seedCatalogReference } from './seed';

const SERVICE_NAME = 'marketplace-service';
const CONFIG_API_URL = process.env.CONFIG_API_URL ?? 'http://localhost:3190';

/**
 * The marketplace-service composition root — the storefront's read host and the
 * owner of two platform-plane stores: `catalog-reference` (the operator-authored
 * brand, category and dictionary vocabulary) and `published-catalog` (the
 * projection of every vendor's approved offerings).
 *
 * **`MongoDatabaseLayer`, not `MongoClientLayer`** — the opposite of
 * marketplace-admin-service, and for the opposite reason. Both of this slice's
 * stores are `partitioning: 'single'`, so naming a database at boot is correct
 * here; the catalog's handles are all per-organization, so naming one there
 * would have created a database nothing ever writes.
 *
 * No Redis and no AMQP yet. The publisher that consumes `catalog.published` and
 * writes `published-catalog` is the next iteration's work
 * ([ADR 0009](../../../docs/adr/0009-catalog-authoring-and-publication.md));
 * until it exists this service serves reads and the operator's vocabulary CRUD,
 * and adding a connection for a subscriber that does not run would be a
 * dependency to probe for no return.
 */
export const AppLayer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const plain = yield* loadRemoteConfiguration(CONFIG_API_URL, SERVICE_NAME);
    const store = new ConfigurationClientInMemory(plain);

    const uri = yield* store.in('mongo').getString('uri');
    const dbName = yield* store.in('mongo').getString('db');

    // The public half only. This service verifies access tokens and never mints
    // one, so it is configured with material that cannot sign.
    const jwtPublicKey = yield* store.in('jwt').getString('publicKey');
    const jwtKeyId = yield* store.in('jwt').getString('keyId');

    // Log level + sink and the OTLP endpoint, read from this service's own
    // configuration. Which keys and which are optional is the shell's, so every
    // service reads them the same way.
    const observability = yield* observabilityFromConfiguration(
      store,
      SERVICE_NAME,
    );

    const connections = Layer.mergeAll(
      MongoDatabaseLayer({ uri, dbName }),
      Layer.succeed(
        TokenServiceTag,
        makeJoseTokenService({
          publicKeyPem: jwtPublicKey,
          keyId: jwtKeyId,
          issuer: AUTH_TOKEN_ISSUER,
          audience: AUTH_TOKEN_AUDIENCE,
        }),
      ),
      Layer.succeed(ConfigurationRepositoryTag, store),
      Layer.succeed(LoadedConfigurationTag, plain),
      Layer.succeed(PolicyDecisionTag, makeStaticPolicyDecision()),
    );

    // One Mongo database backing two platform-plane Stores: the operator's
    // `catalog-reference` vocabulary and the `published-catalog` projection.
    const withProbes = Layer.provideMerge(
      MongoHealthProbeLayer(['catalog-reference', 'published-catalog']),
      connections,
    );

    return Layer.merge(
      observability,
      Layer.provideMerge(Layer.effectDiscard(seedCatalogReference), withProbes),
    );
  }).pipe(Effect.orDie),
).pipe(Layer.orDie);
