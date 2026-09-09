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
  MongoDatabaseTag,
  MongoHealthProbeLayer,
} from '@r10c/entifix-ts-mongo-client';
import {
  LoadedConfigurationTag,
  loadRemoteConfiguration,
  observabilityFromConfiguration,
  ServiceCrossingTokenTag,
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';

import { ensureOutboxIndexes } from './outbox';

const SERVICE_NAME = 'order-service';
const CONFIG_API_URL = process.env.CONFIG_API_URL ?? 'http://localhost:3190';

/**
 * The order-service composition root — the `order` store's only writer.
 *
 * ⚠️ **`MongoDatabaseLayer`, not `MongoClientLayer`, and that is the plane
 * rather than a preference.** stock-service and marketplace-admin-service take
 * the pool and resolve `stock_<id>` / `tenant_<id>` inside each request, because
 * their stores are per-organization. The `order` store is **platform** plane and
 * single-partitioned: one database, named at boot. Resolving a handle per
 * request here would be inventing a tenancy the store does not have — and a
 * basket spanning two vendors could not live in either of their databases
 * anyway, which is *why* it is platform plane (ADR 0022,
 * `docs/_shared/planes.md`).
 *
 * ⚠️ **A crossing token, and this service's own.** It is a saga *participant*:
 * the coordinator writes an order on a buyer's behalf, and the buyer holds no
 * grant over that act. Reusing stock-service's token — or the fleet's
 * `CONFIG_SERVICE_TOKEN` — would make one leaked secret reach both stores at
 * once, so it is a separate `is_secret` row with its own rotation
 * ([ADR 0023](../../../docs/adr/0023-service-to-service-tenant-crossing.md)).
 *
 * No Redis and no AMQP **yet**. This slice takes no lock and draws from no
 * sequence; it declares `order.placed`, whose entry is written into the outbox
 * with the order, and the relay that drains it lands with the consumer that
 * gives it somewhere to go (M4's payment slice). An entry written and not yet
 * published is exactly what an outbox is for.
 */
export const AppLayer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const plain = yield* loadRemoteConfiguration(CONFIG_API_URL, SERVICE_NAME);
    const store = new ConfigurationClientInMemory(plain);

    const uri = yield* store.in('mongo').getString('uri');
    const db = yield* store.in('mongo').getString('db');

    // The public half only. This service verifies access tokens and never mints
    // one, so it is configured with material that cannot sign.
    const jwtPublicKey = yield* store.in('jwt').getString('publicKey');
    const jwtKeyId = yield* store.in('jwt').getString('keyId');

    const crossingToken = yield* store.in('service').getString('token');

    const observability = yield* observabilityFromConfiguration(
      store,
      SERVICE_NAME,
    );

    const connections = Layer.mergeAll(
      MongoDatabaseLayer({ uri, dbName: db }),
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
      Layer.succeed(ServiceCrossingTokenTag, crossingToken),
    );

    // Named by the logical Store it backs rather than by the driver, so
    // `/api/health/ready` describes this service in the register's vocabulary
    // (ADR 0031).
    const withProbes = Layer.provideMerge(
      MongoHealthProbeLayer(['order']),
      connections,
    );

    // Before the first write, and here rather than per request: unlike a tenant
    // database this one is named at boot, so there *is* a boot moment at which
    // the index can be created — and an outbox whose `eventId` is not unique
    // would let a redelivery enqueue a second copy of the same announcement.
    const indexed = Layer.provideMerge(
      Layer.effectDiscard(
        Effect.flatMap(MongoDatabaseTag, database =>
          ensureOutboxIndexes(database),
        ),
      ),
      withProbes,
    );

    return Layer.merge(observability, Layer.provideMerge(indexed, withProbes));
  }).pipe(Effect.orDie),
).pipe(Layer.orDie);
