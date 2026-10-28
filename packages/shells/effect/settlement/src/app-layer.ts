import { MongoDatabaseTag } from '@entifix/mongo';
import {
  ensureInboxIndexes,
  ensureOutboxIndexes,
  startOutboxRelay,
} from '@entifix/mongo/transactions';
import { logMechanismOutcome } from '@entifix/service-shell';
import { MongoSettlementStoreLayer } from '@r10c/implementation-settlement-mongo';
import {
  fleetBusLayer,
  type FleetConfiguration,
  fleetOutboxLayer,
  fleetSecurityLayer,
  fleetSingleMongoLayer,
  makeFleetServiceLayer,
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';
import type { Db } from 'mongodb';

import { startSettlementFold } from './fold-subscriptions.js';
import { SettlementRunIntervalMs, startSettlementSweep } from './run-sweep.js';

const SERVICE_NAME = 'settlement-service';

/** The **slice** this service publishes as — never the deployment, never the domain (ADR 0029). */
export const SETTLEMENT_SLICE = 'settlement';

/**
 * The `settlement` slice's composition, mounted by its service alone (ADR 0064) — the `settlement` store's only
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
 * ([ADR 0023](../../../../../docs/adr/0023-service-to-service-tenant-crossing.md)).
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
/** The outbox's and the inbox's indexes, before the first write to either. */
export const ensureBusIndexes = (database: Db) =>
  Effect.all([ensureOutboxIndexes(database), ensureInboxIndexes(database)]);

/**
 * What the service brings to its slice's composition: the demo seed is the
 * app's data, so it is handed in rather than owned here (ADR 0064).
 */
export interface SettlementShellOptions {
  /** Writes the lab's agreement for the named organization. */
  readonly seed: (
    organizationId: string,
  ) => Effect.Effect<void, unknown, MongoDatabaseTag>;
}

export const settlementComposition =
  (options: SettlementShellOptions) => (configuration: FleetConfiguration) =>
    Effect.gen(function* () {
      const { store } = configuration;

      // The vendor whose agreement the lab seeds. The same id auth-service seeds
      // the `Organization` under and every other slice hangs its demo data off, so
      // it is configuration rather than a constant duplicated per codebase.
      const demoOrganizationId = yield* store
        .in('tenant')
        .getString('demoOrganizationId');

      // How often the sweep looks for unsettled lines. A dial rather than a
      // constant because nothing about it is baked into a queue declaration or an
      // index — and because a run states the period it actually covered, so
      // changing the cadence does not invalidate what came before.
      const runIntervalMs = yield* store
        .in('settlement')
        .getNumber('runIntervalMs');

      const connections = Layer.mergeAll(
        yield* fleetSingleMongoLayer(configuration, ['settlement']),
        yield* fleetBusLayer(configuration),
        yield* fleetSecurityLayer(configuration),
        yield* fleetOutboxLayer(configuration, SETTLEMENT_SLICE),
        Layer.succeed(SettlementRunIntervalMs, runIntervalMs),
      );

      // Before the first write, and here rather than per request: unlike a tenant
      // database this one is named at boot, so there *is* a boot moment at which
      // an index can be created. Three of them are load-bearing rather than
      // performance work — the outbox's `eventId`, the inbox's
      // `(consumer, eventId)` claim, and the ledger's `(orderId, vendorId)`.
      const indexed = Layer.provideMerge(
        Layer.effectDiscard(Effect.flatMap(MongoDatabaseTag, ensureBusIndexes)),
        connections,
      );

      // ⚠️ **`Layer.provideMerge` over `indexed`, never a sibling in a
      // `Layer.mergeAll`.** `mergeAll` builds its members concurrently, and the
      // seed writes the very collection whose unique index is being created beside
      // it — a sibling would race that index into existence *after* the row it is
      // meant to constrain.
      // The store ensures the ledger's own indexes as it builds; the seed is
      // chained after it, so the agreement it writes lands under them.
      const seeded = Layer.provideMerge(
        Layer.effectDiscard(options.seed(demoOrganizationId)),
        Layer.provideMerge(MongoSettlementStoreLayer, indexed),
      );

      return Layer.provideMerge(
        Layer.mergeAll(
          Layer.effectDiscard(
            startOutboxRelay({ onOutcome: logMechanismOutcome }),
          ),
          Layer.effectDiscard(startSettlementFold),
          Layer.effectDiscard(startSettlementSweep),
        ),
        seeded,
      );
    });

/** The composition, booted against the configuration config-service serves. */
export const makeAppLayer = (options: SettlementShellOptions) =>
  makeFleetServiceLayer(SERVICE_NAME, settlementComposition(options));
