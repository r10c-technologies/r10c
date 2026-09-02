import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { BoundSubscription, WiringRegistry } from './wiring-registry.js';
import {
  BOUND_SUBSCRIPTION_MODES,
  WiringRegistryLayer,
  WiringRegistryTag,
} from './wiring-registry.js';

const withRegistry = <A>(
  body: (registry: WiringRegistry) => Effect.Effect<A>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* WiringRegistryTag;
      return yield* body(registry);
    }).pipe(Effect.provide(WiringRegistryLayer)),
  );

const TRACKER: BoundSubscription = {
  slice: 'transaction',
  pattern: 'transaction.*',
  mode: 'work',
  queue: 'transaction.transaction._star_',
};

describe('WiringRegistry', () => {
  it('starts empty', async () => {
    const both = await withRegistry(registry =>
      Effect.all({
        subscriptions: registry.subscriptions,
        published: registry.published,
      }),
    );

    expect(both).toEqual({ subscriptions: [], published: [] });
  });

  it('records a binding', async () => {
    const bound = await withRegistry(registry =>
      Effect.gen(function* () {
        yield* registry.recordSubscription(TRACKER);
        return yield* registry.subscriptions;
      }),
    );

    expect(bound).toEqual([TRACKER]);
  });

  /**
   * A reconnect re-runs every consumer's setup against the new channel
   * (`AmqpConnector.addConsumer`), so without dedup a broker restart would list
   * the same binding twice and the map would read as two consumers.
   */
  it('records a repeated binding once', async () => {
    const bound = await withRegistry(registry =>
      Effect.gen(function* () {
        yield* registry.recordSubscription(TRACKER);
        yield* registry.recordSubscription({ ...TRACKER });
        return yield* registry.subscriptions;
      }),
    );

    expect(bound).toEqual([TRACKER]);
  });

  // The same interest in two modes is two queues, so it is two bindings.
  it('keeps two bindings that differ only in mode', async () => {
    const bound = await withRegistry(registry =>
      Effect.gen(function* () {
        yield* registry.recordSubscription(TRACKER);
        yield* registry.recordSubscription({
          ...TRACKER,
          mode: 'broadcast',
          queue: 'amq.gen-abc',
        });
        return yield* registry.subscriptions;
      }),
    );

    expect(bound).toHaveLength(2);
  });

  // A publisher emits the same name continuously; the document is a set of
  // names, never a count, so the list must not grow with the traffic.
  it('records each event name once, in first-seen order', async () => {
    const published = await withRegistry(registry =>
      Effect.gen(function* () {
        yield* registry.recordPublish('transaction.accepted');
        yield* registry.recordPublish('transaction.completed');
        yield* registry.recordPublish('transaction.accepted');
        return yield* registry.published;
      }),
    );

    expect(published).toEqual([
      'transaction.accepted',
      'transaction.completed',
    ]);
  });

  /**
   * Pinned against `SubscriptionMode` in `@r10c/entifix-transactions` and
   * `SUBSCRIPTION_MODES` in `tools/slices/`. The literals are duplicated because
   * both of those sit above this package, so nothing but a spec can see them
   * drift.
   */
  it('carries the two subscription modes the bus offers', () => {
    expect([...BOUND_SUBSCRIPTION_MODES]).toEqual(['work', 'broadcast']);
  });
});
