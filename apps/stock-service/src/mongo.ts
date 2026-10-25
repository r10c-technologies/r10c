import {
  crossingTokenLayer,
  fleetSecurityLayer,
  fleetTenantMongoLayer,
  makeFleetServiceLayer,
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';

import {
  startReservationSweep,
  StockDatabasePrefix,
} from './reservation-sweep';
import { ReservationTtlSecondsTag } from './reservation-ttl';
import { seedStock } from './seed';

const SERVICE_NAME = 'stock-service';

/**
 * The stock-service composition root — the `stock` store's only writer.
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
 * No Redis, no AMQP. This slice takes no distributed lock — ADR 0010 prohibits
 * one per decrement, because it would serialize every purchase of a popular
 * item through a single key — draws from no sequence, and declares no published
 * event, so there is no outbox to commit alongside a write.
 */
export const AppLayer = makeFleetServiceLayer(SERVICE_NAME, configuration =>
  Effect.gen(function* () {
    const { store } = configuration;

    // `stock_`, read again here for the seed and the reaper; `fleetTenantMongoLayer`
    // builds the tenant resolver from the same row.
    const tenantPrefix = yield* store.in('tenant').getString('dbPrefix');

    // The local demo vendor, whose stock positions this service seeds. The same
    // id auth-service provisions and marketplace-admin-service seeds a catalog
    // under — three services now agree on it, which is why it is a
    // configuration row rather than a constant in three codebases.
    const demoOrganizationId = yield* store
      .in('tenant')
      .getString('demoOrganizationId');

    // How long a hold survives. Configuration rather than a constant for the
    // reason `tenant.dbPrefix` is — see `reservation-ttl.ts`.
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
      Layer.succeed(ReservationTtlSecondsTag, reservationTtlSeconds),
      // The reaper's prefix — the same `stock_` the tenant resolver is built
      // with, because it enumerates the databases that resolver hands out.
      Layer.succeed(StockDatabasePrefix, tenantPrefix),
    );

    // The demo vendor's stock, written on first boot into `stock_<id>`.
    //
    // ⚠️ **`Layer.provideMerge` over the connections, never a sibling in a
    // `Layer.mergeAll`.** `mergeAll` builds its members concurrently, and Mongo
    // creates a tenant database on first write — so a sibling that also touched
    // `stock_<id>` would race the seed on a fresh `dev:reset`.
    const seeded = Layer.provideMerge(
      Layer.effectDiscard(seedStock(`${tenantPrefix}${demoOrganizationId}`)),
      connections,
    );

    // ⚠️ **The reaper is chained after the seed, not merged beside it**, for the
    // reason the seed itself is chained. Without this daemon `expiresAt` is a
    // timestamp nothing reads: every abandoned basket promises a vendor's stock
    // permanently (ADR 0010's reaper, #227).
    return Layer.provideMerge(
      Layer.effectDiscard(startReservationSweep),
      seeded,
    );
  }),
);
