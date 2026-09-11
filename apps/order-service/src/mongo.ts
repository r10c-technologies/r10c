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
  ensureOutboxIndexes,
  MongoDatabaseLayer,
  MongoDatabaseTag,
  MongoHealthProbeLayer,
  OutboxMaxAttempts,
  startOutboxRelay,
} from '@r10c/entifix-ts-mongo-client';
import {
  LoadedConfigurationTag,
  loadRemoteConfiguration,
  observabilityFromConfiguration,
  ServiceCrossingTokenTag,
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';

import { CancelWindowSeconds } from './cancel-capability';
import { ORDER_SLICE } from './outbox';
import { ensureProductOrderIndexes } from './product-order-index';
import { startPaymentStatusProjection } from './projection/payment-status';

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
 * ⚠️ **AMQP is dialled at boot and probed.** A service that opens a broker
 * connection eagerly and registers no probe exits `1` against a merely slow
 * broker while the health ladder green-lights a booting fleet — the trap
 * marketplace-service hit. `AmqpHealthProbeLayer` sits in the probe tier above
 * the bus for exactly that reason.
 *
 * The broker earns its place twice over: the relay publishes `order.placed`
 * (#232), and the projection consumes `payment.captured` to advance an order
 * from `pending` to `paid`. The capture itself is a saga step and does not
 * arrive here as a message — only its consequence does
 * ([ADR 0054](../../../docs/adr/0054-capture-is-the-pivot-and-the-bus-carries-what-follows.md)).
 *
 * No Redis: this slice takes no lock and draws from no sequence.
 */
export const AppLayer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const plain = yield* loadRemoteConfiguration(CONFIG_API_URL, SERVICE_NAME);
    const store = new ConfigurationClientInMemory(plain);

    const uri = yield* store.in('mongo').getString('uri');
    const db = yield* store.in('mongo').getString('db');
    const amqpUri = yield* store.in('rabbitmq').getString('uri');

    // The public half only. This service verifies access tokens and never mints
    // one, so it is configured with material that cannot sign.
    const jwtPublicKey = yield* store.in('jwt').getString('publicKey');
    const jwtKeyId = yield* store.in('jwt').getString('keyId');

    const crossingToken = yield* store.in('service').getString('token');

    // ⚠️ `getNumber`, never a cast. A value of `'five'` casts to `NaN`, every
    // comparison against it goes false, and nothing is ever quarantined — a
    // relay that looks healthy while its head never moves.
    const outboxMaxAttempts = yield* store
      .in('outbox')
      .getNumber('maxAttempts');

    // The buyer's own cancel window, in seconds. Read here rather than in the
    // route so a missing row stops the process at boot instead of failing one
    // checkout at request time — and `getNumber` rather than a cast, because a
    // `NaN` window is a window every comparison falls out of.
    const cancelWindowSeconds = yield* store
      .in('order')
      .getNumber('cancelWindowSeconds');

    const observability = yield* observabilityFromConfiguration(
      store,
      SERVICE_NAME,
    );

    const connections = Layer.mergeAll(
      MongoDatabaseLayer({ uri, dbName: db }),
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
      Layer.succeed(ServiceCrossingTokenTag, crossingToken),
      // The **slice**, never the deployment and never the domain (ADR 0029).
      Layer.succeed(EventSourceTag, ORDER_SLICE),
      Layer.succeed(OutboxMaxAttempts, outboxMaxAttempts),
      Layer.succeed(CancelWindowSeconds, cancelWindowSeconds),
    );

    const infra = Layer.provideMerge(AmqpEventBusLayer, connections);

    // Named by the logical Store it backs rather than by the driver, so
    // `/api/health/ready` describes this service in the register's vocabulary
    // (ADR 0031).
    const withProbes = Layer.provideMerge(
      Layer.mergeAll(MongoHealthProbeLayer(['order']), AmqpHealthProbeLayer),
      infra,
    );

    // Before the first write, and here rather than per request: unlike a tenant
    // database this one is named at boot, so there *is* a boot moment at which
    // the index can be created — and an outbox whose `eventId` is not unique
    // would let a redelivery enqueue a second copy of the same announcement.
    // The order indexes ride along for a different reason: every read of this
    // store is scoped by a predicate rather than by a handle, so without them
    // the scope is a collection scan.
    const indexed = Layer.provideMerge(
      Layer.effectDiscard(
        Effect.flatMap(MongoDatabaseTag, database =>
          Effect.zipRight(
            ensureOutboxIndexes(database),
            ensureProductOrderIndexes(database),
          ),
        ),
      ),
      withProbes,
    );

    return Layer.merge(
      observability,
      Layer.provideMerge(
        Layer.mergeAll(
          indexed,
          Layer.effectDiscard(startOutboxRelay()),
          Layer.effectDiscard(startPaymentStatusProjection),
        ),
        withProbes,
      ),
    );
  }).pipe(Effect.orDie),
).pipe(Layer.orDie);
