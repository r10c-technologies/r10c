import { HealthRegistryTag } from '@r10c/entifix-ts-business';
import { Effect, Layer } from 'effect';

import { AmqpChannelTag, EVENTS_EXCHANGE } from './amqp-connection';

/** Probe name reported by `/api/health/ready` when RabbitMQ is unreachable. */
export const AMQP_PROBE_NAME = 'amqp';

/**
 * Registers a readiness probe for the AMQP connection: a passive assert of the
 * shared events exchange. Passive means it never creates anything — it
 * asks the broker whether the exchange is there, which fails fast on both a
 * dead connection and a broker that lost the topology.
 *
 * It runs through the connector rather than against a held channel, and that
 * matters more than it looks: amqplib **closes the channel** when a passive
 * check fails. Against a single boot-time channel one failed probe therefore
 * killed publishing and consuming permanently — the readiness check was itself
 * a way to break the bus. Now the dead channel is simply dropped and the next
 * call reopens one.
 */
export const AmqpHealthProbeLayer: Layer.Layer<
  never,
  never,
  AmqpChannelTag | HealthRegistryTag
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const connector = yield* AmqpChannelTag;
    const registry = yield* HealthRegistryTag;

    yield* registry.register({
      name: AMQP_PROBE_NAME,
      kind: 'broker',
      // The exchange itself is the logical name, and it is the same for every
      // service — so unlike a store this one needs no argument from the
      // composition root (ADR 0031).
      targets: [EVENTS_EXCHANGE],
      check: Effect.tryPromise(() =>
        connector.withChannel(channel =>
          channel.checkExchange(EVENTS_EXCHANGE),
        ),
      ).pipe(
        Effect.as(true),
        Effect.catchAll(() => Effect.succeed(false)),
      ),
    });
  }),
);
