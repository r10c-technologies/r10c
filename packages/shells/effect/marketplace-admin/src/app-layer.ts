import type { MongoClientTag } from '@entifix/mongo';
import { startTenantOutboxRelay } from '@entifix/mongo/transactions';
import { RedisHealthProbeLayer, RedisLayer } from '@entifix/redis';
import {
  RedisLockServiceLayer,
  RedisSequenceServiceLayer,
} from '@entifix/redis/transactions';
import { logMechanismOutcome } from '@entifix/service-shell';
import {
  MongoOfferingCatalogLayer,
  MongoSpecificationCommandsLayer,
} from '@r10c/implementation-catalog-mongo';
import {
  fleetBusLayer,
  type FleetConfiguration,
  fleetOutboxLayer,
  fleetSecurityLayer,
  fleetTenantMongoLayer,
  makeFleetServiceLayer,
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';

import { startRebuildWalk } from './rebuild-walk.js';

const SERVICE_NAME = 'marketplace-admin-service';
/** The slice publishing this process's events (ADR 0020, `tools/slices/`). */
const SLICE_NAME = 'marketplace-admin';

/**
 * The `marketplace-admin` slice's composition, mounted by its service alone (ADR 0064). Resolves its own parameters
 * from config-service at boot (`mongo.uri`), opens the Mongo connection,
 * provides the configuration store + loaded config for introspection, and seeds
 * the catalog collections once.
 *
 * `Layer.unwrap` defers the boot-time config fetch into the layer graph so
 * `makeService`'s `Layer.launch` owns startup and graceful shutdown. Any boot
 * failure (config unreachable, missing keys) crashes the service (`orDie`).
 */
/**
 * What the service brings to its slice's composition: the demo catalog is the
 * app's data, so it is handed in rather than owned here (ADR 0064).
 */
export interface MarketplaceAdminShellOptions {
  /** Writes the lab's catalog into the named tenant database. */
  readonly seed: (
    tenantDbName: string,
  ) => Effect.Effect<void, unknown, MongoClientTag>;
}

export const marketplaceAdminComposition =
  (options: MarketplaceAdminShellOptions) =>
  (configuration: FleetConfiguration) =>
    Effect.gen(function* () {
      const { store } = configuration;

      const tenantPrefix = yield* store.in('tenant').getString('dbPrefix');
      const demoOrganizationId = yield* store
        .in('tenant')
        .getString('demoOrganizationId');
      const redisUri = yield* store.in('redis').getString('uri');

      const connections = Layer.mergeAll(
        // The pool only. This service owns no single named database: every catalog
        // handle is `tenant_<organizationId>`, resolved per request. Connecting to
        // a named one would put a database in Mongo that nothing ever writes — a
        // phantom store (ADR 0020). The `saga` store left with its slice when
        // ADR 0039's `:3103` trigger fired (#229), so only `catalog` is probed.
        yield* fleetTenantMongoLayer(configuration, ['catalog']),
        // Locks and code sequences for the transactional create.
        Layer.provideMerge(
          Layer.mergeAll(
            RedisLockServiceLayer,
            RedisSequenceServiceLayer,
            RedisHealthProbeLayer(['saga-coordination']),
          ),
          RedisLayer({ uri: redisUri }),
        ),
        yield* fleetBusLayer(configuration),
        yield* fleetSecurityLayer(configuration),
        // Stamped onto every event this process publishes. The **slice**, not the
        // deployment: the `transaction` slice was co-deployed here, and a source
        // that named the process would relabel marketplace-admin's events the day
        // the two split apart.
        yield* fleetOutboxLayer(configuration, SLICE_NAME),
      );

      return Layer.provideMerge(
        Layer.mergeAll(
          // ⚠️ **The rebuild is chained to the seed, not merged beside it.**
          // `Layer.mergeAll` builds its members concurrently, so a sibling
          // rebuild races the seed on a fresh `dev:reset`: Mongo creates a
          // tenant database on its first write, `the directory would list
          // none, and the walk would announce nothing — leaving the storefront
          // empty, intermittently, which is the failure this walk exists to
          // remove.
          Layer.effectDiscard(
            options
              .seed(`${tenantPrefix}${demoOrganizationId}`)
              .pipe(Effect.andThen(startRebuildWalk)),
          ),
          Layer.effectDiscard(
            startTenantOutboxRelay({ onOutcome: logMechanismOutcome }),
          ),
        ),
        // The catalog store's two non-save writes, over the same connections.
        Layer.provideMerge(
          Layer.mergeAll(
            MongoOfferingCatalogLayer,
            MongoSpecificationCommandsLayer,
          ),
          connections,
        ),
      );
    });

/** The composition, booted against the configuration config-service serves. */
export const makeAppLayer = (options: MarketplaceAdminShellOptions) =>
  makeFleetServiceLayer(SERVICE_NAME, marketplaceAdminComposition(options));
