import {
  AUTH_TOKEN_AUDIENCE,
  AUTH_TOKEN_ISSUER,
} from '@r10c/business-ts-authn';
import {
  makeStaticPolicyDecision,
  PolicyDecisionTag,
} from '@r10c/business-ts-authz';
import { EventSourceTag } from '@r10c/entifix-transactions';
import {
  AmqpEventBusLayer,
  AmqpHealthProbeLayer,
  AmqpLayer,
} from '@r10c/entifix-ts-amqp-client';
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

import { startProjecting } from './projection/publish-catalog';
import { seedCatalogReference } from './seed';

const SERVICE_NAME = 'marketplace-service';
/**
 * The **slice**, not the deployment. Stamped onto anything this process
 * publishes; it consumes today and publishes nothing, but `AmqpEventBusLayer`
 * is one port with both halves, and a source resolved at the composition root
 * is what keeps a future publish from being signed by nobody (ADR 0029).
 */
const SLICE_NAME = 'marketplace';
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
 * **AMQP, and no Redis.** This service now consumes `catalog.*` off the bus and
 * writes the `published-catalog` projection — which is what makes it the
 * projection's single writer and keeps the public read host out of tenant
 * storage entirely
 * ([ADR 0009](../../../docs/adr/0009-catalog-authoring-and-publication.md)).
 * There is still no Redis: this slice takes no distributed lock and draws from
 * no sequence.
 *
 * ⚠️ The broker connection brings `AmqpHealthProbeLayer` with it, and that is
 * not optional. A service that dials RabbitMQ at boot and probes nothing exits
 * `1` against a broker that is merely slow, while the health ladder green-lights
 * a fleet that is still coming up.
 */
export const AppLayer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const plain = yield* loadRemoteConfiguration(CONFIG_API_URL, SERVICE_NAME);
    const store = new ConfigurationClientInMemory(plain);

    const uri = yield* store.in('mongo').getString('uri');
    const dbName = yield* store.in('mongo').getString('db');
    const amqpUri = yield* store.in('rabbitmq').getString('uri');

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
      AmqpLayer({ uri: amqpUri }),
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
      Layer.succeed(EventSourceTag, SLICE_NAME),
    );

    // The bus, built from the connection above and merged back so the projector
    // can reach it. `AmqpEventBusLayer` registers its own `stop-intake` drain,
    // which is why the projector registers no shutdown hook of its own.
    const infra = Layer.provideMerge(AmqpEventBusLayer, connections);

    // Every connection contributes its own readiness probe. One Mongo database
    // backs two platform-plane Stores — the operator's `catalog-reference`
    // vocabulary and the `published-catalog` projection — and the broker is
    // named by the exchange it checks rather than by a Store, because a
    // transport is not a Store.
    const withProbes = Layer.provideMerge(
      Layer.mergeAll(
        MongoHealthProbeLayer(['catalog-reference', 'published-catalog']),
        AmqpHealthProbeLayer,
      ),
      infra,
    );

    return Layer.merge(
      observability,
      Layer.provideMerge(
        Layer.mergeAll(
          Layer.effectDiscard(seedCatalogReference),
          // Binds `catalog.*` and starts writing the projection.
          Layer.effectDiscard(startProjecting),
        ),
        withProbes,
      ),
    );
  }).pipe(Effect.orDie),
).pipe(Layer.orDie);
