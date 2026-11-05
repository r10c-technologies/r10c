import type { MongoClientTag } from '@entifix/mongo';
import { startTenantOutboxRelay } from '@entifix/mongo/transactions';
import { logMechanismOutcome } from '@entifix/service-shell';
import { ReservationTtlSecondsTag } from '@r10c/business-ts-stock-management';
import { MongoStockLedgerLayer } from '@r10c/implementation-stock-mongo';
import {
  crossingTokenLayer,
  fleetBusLayer,
  type FleetConfiguration,
  fleetIdempotencyLayer,
  fleetOutboxLayer,
  fleetSecurityLayer,
  fleetTenantMongoLayer,
  makeFleetServiceLayer,
} from '@r10c/shells-effect-service';
import { SEEDED_VENDORS, type SeededVendor } from '@r10c/utils-ts-fleet';
import { Effect, Layer } from 'effect';

import { startReservationSweep } from './reservation-sweep.js';

const SERVICE_NAME = 'stock-service';

/** The **slice** this service publishes as — never the deployment (ADR 0029). */
export const STOCK_SLICE = 'stock';

/**
 * The `stock` slice's composition, mounted by its service alone (ADR 0064) — the `stock` store's only writer.
 *
 * **`MongoClientLayer`, not `MongoDatabaseLayer`**, for the same reason
 * marketplace-admin-service uses it and marketplace-service does not: every
 * handle here is `stock_<organizationId>`, resolved inside the request from the
 * verified session. Naming a database at boot would create one nothing ever
 * writes — the phantom store ADR 0020 struck `marketplace_admin` for — and the
 * readiness probe does not need one, since it pings `admin`.
 *
 * ⚠️ **The prefix is `stock_`, not `tenant_`.** They are two stores in the same
 * plane with the same partitioning, and the only thing keeping them apart is
 * which prefix this resolver was built with. A copied `tenant_` row here would
 * merge the catalog and the stock store silently: every read would work, every
 * write would land, and two domains would own one database.
 *
 * No Redis. This slice takes no distributed lock — ADR 0010 prohibits one per
 * decrement, because it would serialize every purchase of a popular item
 * through a single key — and draws from no sequence.
 *
 * AMQP and an outbox per `stock_<organizationId>`, because every counter move
 * announces `stock-item.changed` in the unit that made it (#481): the ledger
 * drains each outbox the moment its unit commits, and the tenant relay walks
 * every `stock_*` database for what a drain left behind.
 */
/**
 * What the service brings to its slice's composition: the demo seed is the
 * app's data, so it is handed in rather than owned here (ADR 0064).
 */
export interface StockShellOptions {
  /** Writes one seeded vendor's stock positions into its tenant database. */
  readonly seed: (
    tenantDbName: string,
    vendor: SeededVendor,
  ) => Effect.Effect<void, unknown, MongoClientTag>;
}

/** The database the crossing routes' idempotency records live in. */
export const STOCK_IDEMPOTENCY_DB = 'stock-idempotency';

export const stockComposition =
  (options: StockShellOptions) => (configuration: FleetConfiguration) =>
    Effect.gen(function* () {
      const { store } = configuration;

      // `stock_`, read again here for the seed; `fleetTenantMongoLayer`
      // builds the tenant resolver from the same row.
      const tenantPrefix = yield* store.in('tenant').getString('dbPrefix');

      // How long a hold survives. Configuration rather than a constant for the
      // reason `tenant.dbPrefix` is — see `ReservationTtlSecondsTag`.
      const reservationTtlSeconds = yield* store
        .in('reservation')
        .getNumber('ttlSeconds');

      const connections = Layer.mergeAll(
        yield* fleetTenantMongoLayer(configuration, ['stock']),
        yield* fleetSecurityLayer(configuration),
        // ⚠️ **This service's own crossing secret — not `CONFIG_SERVICE_TOKEN`.**
        // Reusing the fleet's shared token would turn one leaked secret into a
        // tenant-data *write* capability across every organization (ADR 0023).
        yield* crossingTokenLayer(configuration),
        yield* fleetBusLayer(configuration),
        yield* fleetOutboxLayer(configuration, STOCK_SLICE),
        Layer.succeed(ReservationTtlSecondsTag, reservationTtlSeconds),
      );

      // The demo vendor's stock, written on first boot into `stock_<id>`.
      //
      // ⚠️ **`Layer.provideMerge` over the connections, never a sibling in a
      // `Layer.mergeAll`.** `mergeAll` builds its members concurrently, and Mongo
      // creates a tenant database on first write — so a sibling that also touched
      // `stock_<id>` would race the seed on a fresh `dev:reset`.
      // The crossing routes' idempotency records. A tenant handle is resolved
      // per request and the key names no organization, so they live in one
      // database of their own, `stock-idempotency` — a name the tenant
      // directory's `stock_` prefix never matches.
      const idempotency = yield* fleetIdempotencyLayer(
        configuration,
        STOCK_IDEMPOTENCY_DB,
      );

      const seeded = Layer.provideMerge(
        Layer.mergeAll(MongoStockLedgerLayer, idempotency),
        Layer.provideMerge(
          // Every seeded vendor, from the one list auth-service provisions
          // and the catalog seeds under (`SEEDED_VENDORS`).
          Layer.effectDiscard(
            Effect.all(
              SEEDED_VENDORS.map(vendor =>
                options.seed(`${tenantPrefix}${vendor.organizationId}`, vendor),
              ),
              { discard: true },
            ),
          ),
          connections,
        ),
      );

      // ⚠️ **The reaper is chained after the seed, not merged beside it**, for the
      // reason the seed itself is chained. Without this daemon `expiresAt` is a
      // timestamp nothing reads: every abandoned basket promises a vendor's stock
      // permanently (ADR 0010's reaper, #227).
      return Layer.provideMerge(
        Layer.mergeAll(
          Layer.effectDiscard(startReservationSweep),
          Layer.effectDiscard(
            startTenantOutboxRelay({ onOutcome: logMechanismOutcome }),
          ),
        ),
        seeded,
      );
    });

/** The composition, booted against the configuration config-service serves. */
export const makeAppLayer = (options: StockShellOptions) =>
  makeFleetServiceLayer(SERVICE_NAME, stockComposition(options));
