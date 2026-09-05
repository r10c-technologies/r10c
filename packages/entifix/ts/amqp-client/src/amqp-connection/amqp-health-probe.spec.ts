import type { HealthReport } from '@r10c/entifix-ts-business';
import {
  HealthRegistryLayer,
  HealthRegistryTag,
} from '@r10c/entifix-ts-business';
import type * as amqp from 'amqplib';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import type { AmqpConnector } from './amqp-connection.js';
import { AmqpChannelTag, EVENTS_EXCHANGE } from './amqp-connection.js';
import { AMQP_PROBE_NAME, AmqpHealthProbeLayer } from './amqp-health-probe.js';

const channelWithCheck = (checkExchange: (name: string) => Promise<unknown>) =>
  ({ checkExchange }) as unknown as amqp.Channel;

/**
 * The probe asks the connector for a channel rather than holding one, because a
 * failed passive check closes the channel in amqplib — against a single
 * boot-time channel, one probe failure broke publishing and consuming for good.
 */
const connectorFor = (channel: amqp.Channel): AmqpConnector => ({
  withChannel: use => use(channel),
  addConsumer: async setup => {
    await setup(channel);
  },
  cancelConsumers: async () => undefined,
});

const reportWith = (channel: amqp.Channel): Promise<HealthReport> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* HealthRegistryTag;
      return yield* registry.report;
    }).pipe(
      Effect.provide(
        AmqpHealthProbeLayer.pipe(
          Layer.provideMerge(HealthRegistryLayer),
          Layer.provideMerge(
            Layer.succeed(AmqpChannelTag, connectorFor(channel)),
          ),
        ),
      ),
    ),
  );

/** The registrations themselves, without running any of them. */
const probesWith = (channel: amqp.Channel) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* HealthRegistryTag;
      return yield* registry.probes;
    }).pipe(
      Effect.provide(
        AmqpHealthProbeLayer.pipe(
          Layer.provideMerge(HealthRegistryLayer),
          Layer.provideMerge(
            Layer.succeed(AmqpChannelTag, connectorFor(channel)),
          ),
        ),
      ),
    ),
  );

describe('AmqpHealthProbeLayer', () => {
  it('reports ready when the shared exchange is there', async () => {
    const seen: string[] = [];
    const report = await reportWith(
      channelWithCheck(name => {
        seen.push(name);
        return Promise.resolve({});
      }),
    );

    expect(report).toEqual({ ready: true, failing: [] });
    // Passive check of the exchange the transactions layer publishes through —
    // asserting it here would create topology from a health probe.
    expect(seen).toEqual([EVENTS_EXCHANGE]);
  });

  it('reports failing when the broker rejects the check', async () => {
    const report = await reportWith(
      channelWithCheck(() => Promise.reject(new Error('channel closed'))),
    );

    expect(report).toEqual({ ready: false, failing: [AMQP_PROBE_NAME] });
  });
  /**
   * The exchange is the logical name, and it is the same for every service — so
   * unlike a store this probe needs no argument from the composition root
   * (ADR 0031).
   */
  it('declares the shared exchange, as a broker', async () => {
    const probes = await probesWith(
      channelWithCheck(() => Promise.resolve({})),
    );

    expect(
      probes.map(({ name, kind, targets }) => ({ name, kind, targets })),
    ).toEqual([
      { name: AMQP_PROBE_NAME, kind: 'broker', targets: [EVENTS_EXCHANGE] },
    ]);
  });
});
