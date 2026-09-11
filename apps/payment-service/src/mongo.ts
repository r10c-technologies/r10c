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

import { PAYMENT_SLICE } from './outbox';
import { ensurePaymentIndexes } from './payment-index';
import {
  DEFAULT_SIMULATED_SETTINGS,
  readSimulatedOutcome,
  SimulatedPaymentProviderLayer,
} from './providers/simulated';

const SERVICE_NAME = 'payment-service';
const CONFIG_API_URL = process.env.CONFIG_API_URL ?? 'http://localhost:3190';

/**
 * The payment-service composition root — the `payment` store's only writer.
 *
 * ⚠️ **`MongoDatabaseLayer`, not `MongoClientLayer`, and that is the plane
 * rather than a preference.** stock-service and marketplace-admin-service take
 * the pool and resolve `stock_<id>` / `tenant_<id>` inside each request, because
 * their stores are per-organization. The `payment` store is **platform** plane
 * and single-partitioned: one database, named at boot. A payment belongs to an
 * order, and an order can span several vendors, so it could not live in any one
 * of their tenant databases even if it wanted to (ADR 0022,
 * `docs/_shared/planes.md`).
 *
 * ⚠️ **A crossing token, and this service's own.** It is a saga *participant*:
 * the coordinator captures on a buyer's behalf, and the buyer holds no grant
 * over that act. Reusing order-service's token — or the fleet's
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
 * No Redis: this slice takes no lock and draws from no sequence. Its idempotency
 * is a unique index on a claimed command id, which is stronger than a lock and
 * needs no second datastore.
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

    // Configuration rather than a build flag, so a live pass can force a decline
    // without a rebuild — which is the only way to exercise the saga's
    // compensation path against a running fleet.
    const providerOutcome = yield* store.in('provider').getString('outcome');
    const declineReason = yield* store
      .in('provider')
      .getString('declineReason');

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
      Layer.succeed(EventSourceTag, PAYMENT_SLICE),
      Layer.succeed(OutboxMaxAttempts, outboxMaxAttempts),
      SimulatedPaymentProviderLayer({
        outcome: readSimulatedOutcome(providerOutcome),
        declineReason:
          declineReason === ''
            ? DEFAULT_SIMULATED_SETTINGS.declineReason
            : declineReason,
      }),
    );

    const infra = Layer.provideMerge(AmqpEventBusLayer, connections);

    // Named by the logical Store it backs rather than by the driver, so
    // `/api/health/ready` describes this service in the register's vocabulary
    // (ADR 0031).
    const withProbes = Layer.provideMerge(
      Layer.mergeAll(MongoHealthProbeLayer(['payment']), AmqpHealthProbeLayer),
      infra,
    );

    // Before the first write, and here rather than per request: unlike a tenant
    // database this one is named at boot, so there *is* a boot moment at which
    // the index can be created — and an outbox whose `eventId` is not unique
    // would let a redelivery enqueue a second copy of the same announcement.
    const indexed = Layer.provideMerge(
      Layer.effectDiscard(
        Effect.flatMap(MongoDatabaseTag, database =>
          Effect.zipRight(
            ensureOutboxIndexes(database),
            ensurePaymentIndexes(database),
          ),
        ),
      ),
      withProbes,
    );

    return Layer.merge(
      observability,
      Layer.provideMerge(
        Layer.merge(indexed, Layer.effectDiscard(startOutboxRelay())),
        withProbes,
      ),
    );
  }).pipe(Effect.orDie),
).pipe(Layer.orDie);
