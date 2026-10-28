import type { Resource } from '@effect/opentelemetry/Resource';
import type {
  ConfigurationClientInMemory,
  ConfigurationPlain,
} from '@entifix/core';
import { observabilityFromConfiguration } from '@entifix/service-shell/observability';
import { loadRemoteConfiguration } from '@entifix/service-shell/runtime';
import type { RetryBudgetTag } from '@entifix/transactions';
import { configSourceFor } from '@r10c/utils-ts-fleet';
import { Effect, Layer } from 'effect';

import { fleetConfigurationOf } from './fleet-configuration.js';
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
): Layer.Layer<
  A | Resource | RetryBudgetTag,
  never,
  Exclude<R, RetryBudgetTag>
> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const configuration = fleetConfigurationOf(
        yield* loadRemoteConfiguration(configSourceFor(service)),
      );
      const { store } = configuration;
      const observability = yield* observabilityFromConfiguration(
        store,
        service,
      );
      const retryBudget = yield* fleetRetryBudgetLayer(store);
      const app = yield* build(configuration);
      // Provided *into* the app as well as beside it: the layer above a
      // failure is where a retry is legal, and that layer is in the app.
      return Layer.mergeAll(
        observability,
        Layer.provideMerge(app, retryBudget),
      );
    }).pipe(Effect.orDie),
  ).pipe(Layer.orDie);
