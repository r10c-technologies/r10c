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
  ensureInboxIndexes,
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
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';

import { startSettlementFold } from './fold/subscriptions';
import { SETTLEMENT_SLICE } from './outbox';
import { SettlementRunIntervalMs, startSettlementSweep } from './run/sweep';
import { seedSettlement } from './seed';
import { ensureSettlementIndexes } from './settlement-index';

const SERVICE_NAME = 'settlement-service';
const CONFIG_API_URL = process.env.CONFIG_API_URL ?? 'http://localhost:3190';

/**
 * The settlement-service composition root — the `settlement` store's only
 * writer.
 *
 * ⚠️ **`MongoDatabaseLayer`, not `MongoClientLayer`, and that is the plane
 * rather than a preference.** stock-service and sales-service take the pool and
 * resolve `stock_<id>` / `sales_<id>` inside each request, because their stores
 * are per-organization. The `settlement` store is **control** plane and
 * single-partitioned: one database, named at boot. An `Agreement` is the
 * platform's own record *about* a vendor rather than a record the vendor owns,
 * which is the same character `Entitlement` has and the reason the plane differs
 * from every commerce store beside it (ADR 0022 §8, `docs/_shared/planes.md`).
 *
 * ⚠️ **No crossing token, in either direction.** payment-service and
 * order-service each hold one because a saga dispatches into them on a buyer's
 * behalf. Nothing dispatches into this slice: both of its inputs arrive on the
 * bus, and every route it serves is guarded by a verified session and narrowed
 * to the caller. Seeding a secret it never reads would put a fourth holder of a
 * credential that can name any organization into the fleet for nothing
 * ([ADR 0023](../../../docs/adr/0023-service-to-service-tenant-crossing.md)).
 *
 * ⚠️ **AMQP is dialled at boot and probed.** A service that opens a broker
 * connection eagerly and registers no probe exits `1` against a merely slow
 * broker while the health ladder green-lights a booting fleet — the trap
 * marketplace-service hit. `AmqpHealthProbeLayer` sits in the probe tier above
 * the bus for exactly that reason. It earns its place twice here: the relay
 * publishes `settlement.run.completed`, and **two** subscriptions feed the fold.
 *
 * No Redis: this slice takes no lock and draws from no sequence. A settlement
 * run is the coarse batch a distributed lock is usually reached for, and it uses
 * a conditional write on the run record instead — the record being walked is
 * already the durable claim, which is the argument ADR 0055 made for the saga
 * resume sweep and which holds here for the same reason.
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

    // The vendor whose agreement the lab seeds. The same id auth-service seeds
    // the `Organization` under and every other slice hangs its demo data off, so
    // it is configuration rather than a constant duplicated per codebase.
    const demoOrganizationId = yield* store
      .in('tenant')
      .getString('demoOrganizationId');

    // ⚠️ `getNumber`, never a cast. A value of `'five'` casts to `NaN`, every
    // comparison against it goes false, and nothing is ever quarantined — a
    // relay that looks healthy while its head never moves.
    const outboxMaxAttempts = yield* store
      .in('outbox')
      .getNumber('maxAttempts');

    // How often the sweep looks for unsettled lines. A dial rather than a
    // constant because nothing about it is baked into a queue declaration or an
    // index — and because a run states the period it actually covered, so
    // changing the cadence does not invalidate what came before.
    const runIntervalMs = yield* store
      .in('settlement')
      .getNumber('runIntervalMs');

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
      // The **slice**, never the deployment and never the domain (ADR 0029).
      Layer.succeed(EventSourceTag, SETTLEMENT_SLICE),
      Layer.succeed(OutboxMaxAttempts, outboxMaxAttempts),
      Layer.succeed(SettlementRunIntervalMs, runIntervalMs),
    );

    const infra = Layer.provideMerge(AmqpEventBusLayer, connections);

    // Named by the logical Store it backs rather than by the driver, so
    // `/api/health/ready` describes this service in the register's vocabulary
    // (ADR 0031).
    const withProbes = Layer.provideMerge(
      Layer.mergeAll(
        MongoHealthProbeLayer(['settlement']),
        AmqpHealthProbeLayer,
      ),
      infra,
    );

    // Before the first write, and here rather than per request: unlike a tenant
    // database this one is named at boot, so there *is* a boot moment at which
    // an index can be created. Three of them are load-bearing rather than
    // performance work — the outbox's `eventId`, the inbox's
    // `(consumer, eventId)` claim, and the ledger's `(orderId, vendorId)`.
    const indexed = Layer.provideMerge(
      Layer.effectDiscard(
        Effect.flatMap(MongoDatabaseTag, database =>
          Effect.all([
            ensureOutboxIndexes(database),
            ensureInboxIndexes(database),
            ensureSettlementIndexes(database),
          ]),
        ),
      ),
      withProbes,
    );

    // ⚠️ **`Layer.provideMerge` over `indexed`, never a sibling in a
    // `Layer.mergeAll`.** `mergeAll` builds its members concurrently, and the
    // seed writes the very collection whose unique index is being created beside
    // it — a sibling would race that index into existence *after* the row it is
    // meant to constrain.
    const seeded = Layer.provideMerge(
      Layer.effectDiscard(seedSettlement(demoOrganizationId)),
      indexed,
    );

    return Layer.merge(
      observability,
      Layer.provideMerge(
        Layer.mergeAll(
          seeded,
          Layer.effectDiscard(startOutboxRelay()),
          Layer.effectDiscard(startSettlementFold),
          Layer.effectDiscard(startSettlementSweep),
        ),
        withProbes,
      ),
    );
  }).pipe(Effect.orDie),
).pipe(Layer.orDie);
