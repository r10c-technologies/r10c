import type { Resource } from '@effect/opentelemetry/Resource';
import {
  ConfigurationClientInMemory,
  type ConfigurationPlain,
} from '@entifix/core';
import { observabilityFromConfiguration } from '@entifix/service-shell/observability';
import { loadRemoteConfiguration } from '@entifix/service-shell/runtime';
import type { RetryBudgetTag } from '@entifix/transactions';
import { configSourceFor } from '@r10c/utils-ts-fleet';
import { Effect, Layer } from 'effect';

import { fleetRetryBudgetLayer } from './fleet-retry-budget.js';

/** One service's configuration, as config-service served it at boot. */
export interface FleetConfiguration {
  /** The rows as served — what `GET /api/config` redacts and answers. */
  readonly plain: ConfigurationPlain;
  /** The same rows, read by group and key. */
  readonly store: ConfigurationClientInMemory;
}

/**
 * The composition root every r10c service has: load this service's
 * configuration from config-service, build the service's own layer from it,
 * and run it under the observability that configuration names.
 *
 * Process bootstrap, so it sits outside the coverage gate the way the
 * framework's `makeService` does: it dials config-service and branches on
 * nothing. What a service builds inside `build` is where its decisions are.
 *
 * A boot that cannot read its configuration dies rather than limping: every
 * later decision — which database, which token, which broker — rests on it.
 */
export const makeFleetServiceLayer = <A, E, R>(
  service: string,
  build: (
    configuration: FleetConfiguration,
  ) => Effect.Effect<Layer.Layer<A, E, R>, unknown>,
): Layer.Layer<A | Resource | RetryBudgetTag, never, R> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const plain = yield* loadRemoteConfiguration(configSourceFor(service));
      const store = new ConfigurationClientInMemory(plain);
      const observability = yield* observabilityFromConfiguration(
        store,
        service,
      );
      const retryBudget = yield* fleetRetryBudgetLayer(store);
      const app = yield* build({ plain, store });
      return Layer.mergeAll(observability, retryBudget, app);
    }).pipe(Effect.orDie),
  ).pipe(Layer.orDie);
