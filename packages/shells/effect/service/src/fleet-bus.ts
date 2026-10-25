import { AmqpHealthProbeLayer, AmqpLayer } from '@entifix/amqp';
import { AmqpEventBusLayer } from '@entifix/amqp/transactions';
import { OutboxMaxAttempts } from '@entifix/mongo/transactions';
import { EventSourceTag } from '@entifix/transactions';
import { Effect, Layer } from 'effect';

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
  { store }: FleetConfiguration,
  group: 'rabbitmq' | 'amqp' = 'rabbitmq',
) =>
  Effect.map(store.in(group).getString('uri'), uri =>
    Layer.provideMerge(
      Layer.mergeAll(AmqpEventBusLayer, AmqpHealthProbeLayer),
      AmqpLayer({ uri }),
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
