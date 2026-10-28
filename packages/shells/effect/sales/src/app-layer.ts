import type { MongoClientTag } from '@entifix/mongo';
import {
  type FleetConfiguration,
  fleetSecurityLayer,
  fleetTenantMongoLayer,
  httpPublishedPriceReaderLayer,
  httpSagaStarterLayer,
  makeFleetServiceLayer,
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';

const SERVICE_NAME = 'sales-service';

/**
 * The `sales` slice's composition, mounted by its service alone (ADR 0064) — — the `sales` store's only writer.
 *
 * **`MongoClientLayer`, not `MongoDatabaseLayer`.** Every handle here is
 * `sales_<organizationId>`, resolved inside the request from the verified
 * session. Naming a database at boot would create one nothing ever writes — the
 * phantom store ADR 0020 struck `marketplace_admin` for — and the readiness
 * probe does not need one, since it pings `admin`.
 *
 * ⚠️ **The prefix is `sales_`, and it is the only thing separating this store
 * from two others in the same plane with the same partitioning.** A copied
 * `tenant_` or `stock_` row here would merge two stores silently: every read
 * would work, every write would land, and two domains would own one database.
 *
 * No Redis, no AMQP, and no crossing token **inbound**. Nothing in the fleet
 * calls this service on another organization's behalf: a channel is authored by
 * a member of the organization that owns it, so a verified session is the only
 * credential any route here accepts.
 */
/**
 * What the service brings to its slice's composition: the demo seed is the
 * app's data, so it is handed in rather than owned here (ADR 0064).
 */
export interface SalesShellOptions {
  /** Writes the lab's selling channels into the named tenant database. */
  readonly seed: (
    tenantDbName: string,
  ) => Effect.Effect<void, unknown, MongoClientTag>;
}

export const salesComposition =
  (options: SalesShellOptions) => (configuration: FleetConfiguration) =>
    Effect.gen(function* () {
      const { store } = configuration;

      // Tenant storage: one Mongo database per organization, named from the
      // organization id; the prefix is read by `fleetTenantMongoLayer` below, and again
      // here for the seed's own database name.
      const tenantPrefix = yield* store.in('tenant').getString('dbPrefix');

      // The local demo vendor, whose channels this service seeds. The same id
      // auth-service provisions and the catalog and stock services seed under.
      const demoOrganizationId = yield* store
        .in('tenant')
        .getString('demoOrganizationId');

      // Where the checkout coordinator answers, and what this service presents to
      // start a flow. The token is an `is_secret` row — the security boundary
      // rather than a label, since an unflagged row is served in full from the
      // *unauthenticated* `GET /api/config` this service also mounts.
      const coordinatorUrl = yield* store.in('transaction').getString('url');
      const coordinatorToken = yield* store
        .in('transaction')
        .getString('crossingToken');

      // The published projection a counter sale is priced from — the same records
      // the storefront charges a buyer against, which is what keeps one price for
      // one offering however it sells (ADR 0056).
      const catalogUrl = yield* store.in('marketplace').getString('url');

      const connections = Layer.mergeAll(
        yield* fleetTenantMongoLayer(configuration, ['sales']),
        yield* fleetSecurityLayer(configuration),
        httpSagaStarterLayer({
          url: coordinatorUrl,
          crossingToken: coordinatorToken,
        }),
        httpPublishedPriceReaderLayer(catalogUrl),
      );

      // The demo vendor's channels, written on first boot into `sales_<id>`.
      //
      // ⚠️ **`Layer.provideMerge` over the connections, never a sibling in a
      // `Layer.mergeAll`.** `mergeAll` builds its members concurrently and Mongo
      // creates a tenant database on first write, so a sibling touching
      // `sales_<id>` would race the seed on a fresh `dev:reset` and see a store
      // that is empty, half-seeded or seeded depending on scheduling.
      return Layer.provideMerge(
        Layer.effectDiscard(
          options.seed(`${tenantPrefix}${demoOrganizationId}`),
        ),
        connections,
      );
    });

/** The composition, booted against the configuration config-service serves. */
export const makeAppLayer = (options: SalesShellOptions) =>
  makeFleetServiceLayer(SERVICE_NAME, salesComposition(options));
