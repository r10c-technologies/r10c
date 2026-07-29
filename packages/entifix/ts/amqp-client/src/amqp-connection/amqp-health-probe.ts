import { HealthRegistryTag } from '@r10c/entifix-ts-business';
import { Effect, Layer } from 'effect';

import { AmqpChannelTag, TRANSACTION_EXCHANGE } from './amqp-connection';

/** Probe name reported by `/api/health/ready` when RabbitMQ is unreachable. */
export const AMQP_PROBE_NAME = 'amqp';

/**
 * Registers a readiness probe for the AMQP channel: a passive assert of the
 * shared transaction exchange. Passive means it never creates anything — it
 * asks the broker whether the exchange is there, which fails fast on both a
 * dead connection and a broker that lost the topology.
 */
export const AmqpHealthProbeLayer: Layer.Layer<
  never,
  never,
  AmqpChannelTag | HealthRegistryTag
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const channel = yield* AmqpChannelTag;
    const registry = yield* HealthRegistryTag;

    yield* registry.register({
      name: AMQP_PROBE_NAME,
      check: Effect.tryPromise(() =>
        channel.checkExchange(TRANSACTION_EXCHANGE),
      ).pipe(
        Effect.as(true),
        Effect.catchAll(() => Effect.succeed(false)),
      ),
    });
  }),
);
