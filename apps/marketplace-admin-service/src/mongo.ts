import { startTenantOutboxRelay } from '@entifix/mongo/transactions';
import { RedisHealthProbeLayer, RedisLayer } from '@entifix/redis';
import {
  RedisLockServiceLayer,
  RedisSequenceServiceLayer,
} from '@entifix/redis/transactions';
import { EventSourceTag } from '@entifix/transactions';
import { rebuildEveryPublication } from '@r10c/business-ts-product-configuration-management';
import {
  MongoOfferingCatalogLayer,
  MongoSpecificationCommandsLayer,
} from '@r10c/implementation-catalog-mongo';
import {
  fleetBusLayer,
  fleetOutboxLayer,
  fleetSecurityLayer,
  fleetTenantMongoLayer,
  makeFleetServiceLayer,
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';

import { seedCatalog } from './seed';

const SERVICE_NAME = 'marketplace-admin-service';
/** The slice publishing this process's events (ADR 0020, `tools/slices/`). */
const SLICE_NAME = 'marketplace-admin';

/**
 * The marketplace-admin-service composition root. Resolves its own parameters
 * from config-service at boot (`mongo.uri`), opens the Mongo connection,
 * provides the configuration store + loaded config for introspection, and seeds
 * the catalog collections once.
 *
 * `Layer.unwrap` defers the boot-time config fetch into the layer graph so
 * `makeService`'s `Layer.launch` owns startup and graceful shutdown. Any boot
 * failure (config unreachable, missing keys) crashes the service (`orDie`).
 */
export const AppLayer = makeFleetServiceLayer(SERVICE_NAME, configuration =>
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
          seedCatalog(`${tenantPrefix}${demoOrganizationId}`).pipe(
            Effect.andThen(
              Effect.flatMap(EventSourceTag, source =>
                Effect.forkDetach(rebuildEveryPublication(source)),
              ),
            ),
          ),
        ),
        Layer.effectDiscard(startTenantOutboxRelay()),
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
  }),
);
