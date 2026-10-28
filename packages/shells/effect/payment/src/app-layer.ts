import { MongoDatabaseTag } from '@entifix/mongo';
import {
  ensureOutboxIndexes,
  startOutboxRelay,
} from '@entifix/mongo/transactions';
import { logMechanismOutcome } from '@entifix/service-shell';
import { MongoPaymentLedgerLayer } from '@r10c/implementation-payment-mongo';
import {
  crossingTokenLayer,
  fleetBusLayer,
  type FleetConfiguration,
  fleetOutboxLayer,
  fleetSecurityLayer,
  fleetSingleMongoLayer,
  makeFleetServiceLayer,
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';

import {
  DEFAULT_SIMULATED_SETTINGS,
  readSimulatedOutcome,
  SimulatedPaymentProviderLayer,
} from './simulated-provider.js';

const SERVICE_NAME = 'payment-service';

/** The **slice** this service publishes as — never the deployment, never the domain (ADR 0029). */
export const PAYMENT_SLICE = 'payment';

/**
 * The `payment` slice's composition, mounted by its service alone (ADR 0064) — — the `payment` store's only writer.
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
 * ([ADR 0023](../../../../../docs/adr/0023-service-to-service-tenant-crossing.md)).
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
export const paymentComposition = (configuration: FleetConfiguration) =>
  Effect.gen(function* () {
    const { store } = configuration;

    // Configuration rather than a build flag, so a live pass can force a decline
    // without a rebuild — which is the only way to exercise the saga's
    // compensation path against a running fleet.
    const providerOutcome = yield* store.in('provider').getString('outcome');
    const declineReason = yield* store
      .in('provider')
      .getString('declineReason');

    const connections = Layer.mergeAll(
      yield* fleetSingleMongoLayer(configuration, ['payment']),
      yield* fleetBusLayer(configuration),
      yield* fleetSecurityLayer(configuration),
      yield* crossingTokenLayer(configuration),
      yield* fleetOutboxLayer(configuration, PAYMENT_SLICE),
      SimulatedPaymentProviderLayer({
        outcome: readSimulatedOutcome(providerOutcome),
        declineReason:
          declineReason === ''
            ? DEFAULT_SIMULATED_SETTINGS.declineReason
            : declineReason,
      }),
    );

    // The outbox's indexes before the first write, and the ledger's own as it
    // builds: an outbox whose `eventId` is not unique would let a redelivery
    // enqueue a second copy of the same announcement.
    const ledger = Layer.provideMerge(
      MongoPaymentLedgerLayer,
      Layer.provideMerge(
        Layer.effectDiscard(
          Effect.flatMap(MongoDatabaseTag, ensureOutboxIndexes),
        ),
        connections,
      ),
    );

    return Layer.provideMerge(
      Layer.effectDiscard(startOutboxRelay({ onOutcome: logMechanismOutcome })),
      ledger,
    );
  });

/** The composition, booted against the configuration config-service serves. */
export const makeAppLayer = () =>
  makeFleetServiceLayer(SERVICE_NAME, paymentComposition);
