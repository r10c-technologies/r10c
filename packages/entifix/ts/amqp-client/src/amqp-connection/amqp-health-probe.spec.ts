import type { HealthReport } from '@r10c/entifix-ts-business';
import {
  HealthRegistryLayer,
  HealthRegistryTag,
} from '@r10c/entifix-ts-business';
import type * as amqp from 'amqplib';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { AmqpChannelTag, TRANSACTION_EXCHANGE } from './amqp-connection.js';
import { AMQP_PROBE_NAME, AmqpHealthProbeLayer } from './amqp-health-probe.js';

const channelWithCheck = (checkExchange: (name: string) => Promise<unknown>) =>
  ({ checkExchange }) as unknown as amqp.Channel;

const reportWith = (channel: amqp.Channel): Promise<HealthReport> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* HealthRegistryTag;
      return yield* registry.report;
    }).pipe(
      Effect.provide(
        AmqpHealthProbeLayer.pipe(
          Layer.provideMerge(HealthRegistryLayer),
          Layer.provideMerge(Layer.succeed(AmqpChannelTag, channel)),
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
    expect(seen).toEqual([TRANSACTION_EXCHANGE]);
  });

  it('reports failing when the broker rejects the check', async () => {
    const report = await reportWith(
      channelWithCheck(() => Promise.reject(new Error('channel closed'))),
    );

    expect(report).toEqual({ ready: false, failing: [AMQP_PROBE_NAME] });
  });
});
