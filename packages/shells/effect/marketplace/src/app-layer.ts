import type { MongoDatabaseTag } from '@entifix/mongo';
import { EventSourceTag } from '@entifix/transactions';
import { MongoPublishedCatalogLayer } from '@r10c/implementation-published-catalog-mongo';
import { MongoPublishedVendorsLayer } from '@r10c/implementation-published-vendor-mongo';
import {
  fleetBusLayer,
  type FleetConfiguration,
  fleetSecurityLayer,
  fleetSingleMongoLayer,
  makeFleetServiceLayer,
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';

import { startProjecting } from './publish-catalog.js';
import { startProjectingVendors } from './publish-vendor.js';

const SERVICE_NAME = 'marketplace-service';

/**
 * The **slice**, not the deployment. Stamped onto anything this process
 * publishes; it consumes today and publishes nothing, but `AmqpEventBusLayer`
 * is one port with both halves, and a source resolved at the composition root
 * is what keeps a future publish from being signed by nobody (ADR 0029).
 */
const SLICE_NAME = 'marketplace';

/**
 * The `marketplace` slice's composition, mounted by its service alone (ADR 0064) — the storefront's read host and the
 * owner of three platform-plane stores: `catalog-reference` (the operator-authored
 * brand, category and dictionary vocabulary), `published-catalog` (the
 * projection of every vendor's approved offerings) and `published-vendor` (each
 * seller's display name, projected from the `auth` store's announcements —
 * ADR 0061).
 *
 * **`MongoDatabaseLayer`, not `MongoClientLayer`** — the opposite of
 * marketplace-admin-service, and for the opposite reason. Both of this slice's
 * stores are `partitioning: 'single'`, so naming a database at boot is correct
 * here; the catalog's handles are all per-organization, so naming one there
 * would have created a database nothing ever writes.
 *
 * **AMQP, and no Redis.** This service now consumes `catalog.*` off the bus and
 * writes the `published-catalog` projection — which is what makes it the
 * projection's single writer and keeps the public read host out of tenant
 * storage entirely
 * ([ADR 0009](../../../../../docs/adr/0009-catalog-authoring-and-publication.md)).
 * There is still no Redis: this slice takes no distributed lock and draws from
 * no sequence.
 *
 * ⚠️ The broker connection brings `AmqpHealthProbeLayer` with it, and that is
 * not optional. A service that dials RabbitMQ at boot and probes nothing exits
 * `1` against a broker that is merely slow, while the health ladder green-lights
 * a fleet that is still coming up.
 */
/**
 * What the service brings to its slice's composition: the operator vocabulary
 * the lab starts with is the app's data, so it is handed in rather than owned
 * here (ADR 0064).
 */
export interface MarketplaceShellOptions {
  /** Writes the lab's brands, categories and dictionary terms. */
  readonly seed: Effect.Effect<void, unknown, MongoDatabaseTag>;
}

export const marketplaceComposition =
  (options: MarketplaceShellOptions) => (configuration: FleetConfiguration) =>
    Effect.gen(function* () {
      const connections = Layer.mergeAll(
        // One Mongo database backs three platform-plane Stores — the operator's
        // `catalog-reference` vocabulary and the `published-catalog` and
        // `published-vendor` projections — so the probe names all three.
        yield* fleetSingleMongoLayer(configuration, [
          'catalog-reference',
          'published-catalog',
          'published-vendor',
        ]),
        // `AmqpEventBusLayer` registers its own `stop-intake` drain, which is why
        // the projectors register no shutdown hook of their own.
        yield* fleetBusLayer(configuration),
        yield* fleetSecurityLayer(configuration),
        Layer.succeed(EventSourceTag, SLICE_NAME),
      );

      return Layer.provideMerge(
        Layer.mergeAll(
          Layer.effectDiscard(options.seed),
          // Binds `catalog.*` and starts writing the projection.
          Layer.effectDiscard(startProjecting),
          // Binds `organization.*` and writes each seller's display name.
          Layer.effectDiscard(startProjectingVendors),
        ),
        // The two projections' writers, each ensuring its own indexes as it
        // builds — before the subscriptions that feed them are bound.
        Layer.provideMerge(
          Layer.mergeAll(
            MongoPublishedCatalogLayer,
            MongoPublishedVendorsLayer,
          ),
          connections,
        ),
      );
    });

/** The composition, booted against the configuration config-service serves. */
export const makeAppLayer = (options: MarketplaceShellOptions) =>
  makeFleetServiceLayer(SERVICE_NAME, marketplaceComposition(options));
