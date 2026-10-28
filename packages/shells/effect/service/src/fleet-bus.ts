import { AmqpHealthProbeLayer, AmqpLayer } from '@entifix/amqp';
import {
  AmqpEventBusLayer,
  exponentialRedeliveryBackoff,
  RedeliveryBackoffTag,
} from '@entifix/amqp/transactions';
import { OutboxMaxAttempts } from '@entifix/mongo/transactions';
import { EventSourceTag } from '@entifix/transactions';
import { Effect, Layer } from 'effect';

import { readRetryDials } from './fleet-retry-budget.js';
import type { FleetConfiguration } from './fleet-service.js';

/**
 * The broker connection, the event bus over it and its readiness probe.
 *
 * ⚠️ **Probed because it is dialled at boot.** A service that opens a broker
 * connection eagerly and registers no probe exits against a merely slow broker
 * while the health ladder reports the fleet green.
 *
 * `group` is the configuration group holding `uri`: `rabbitmq` for most of the
 * fleet, `amqp` for the one service whose rows were named that way first.
 */
export const fleetBusLayer = (
  configuration: FleetConfiguration,
  group: 'rabbitmq' | 'amqp' = 'rabbitmq',
) =>
  Effect.gen(function* () {
    const uri = yield* configuration.store.in(group).getString('uri');
    const backoff = yield* fleetRedeliveryBackoffLayer(configuration);
    return Layer.provideMerge(
      Layer.mergeAll(AmqpEventBusLayer, AmqpHealthProbeLayer),
      Layer.merge(AmqpLayer({ uri }), backoff),
    );
  });

/**
 * The wait between a transient failure's redeliveries: the same
 * `backoffBaseMs` / `backoffCapMs` the in-process retries read, from this
 * service's `retry` rows (ADR 0030, entifix ADR 0014).
 */
export const fleetRedeliveryBackoffLayer = ({ store }: FleetConfiguration) =>
  Effect.map(readRetryDials(store), dials =>
    Layer.succeed(
      RedeliveryBackoffTag,
      exponentialRedeliveryBackoff({
        baseMs: dials.backoffBaseMs,
        capMs: dials.backoffCapMs,
      }),
    ),
  );

/**
 * What a publishing slice provides its outbox: the **slice** it publishes as
 * (never the deployment, never the domain — ADR 0029) and the publish attempts
 * an entry gets before quarantine.
 *
 * ⚠️ `getNumber`, never a cast: a value of `'five'` casts to `NaN`, every
 * comparison against it goes false, and nothing is ever quarantined.
 */
export const fleetOutboxLayer = (
  { store }: FleetConfiguration,
  slice: string,
) =>
  Effect.map(store.in('outbox').getNumber('maxAttempts'), maxAttempts =>
    Layer.mergeAll(
      Layer.succeed(EventSourceTag, slice),
      Layer.succeed(OutboxMaxAttempts, maxAttempts),
    ),
  );
