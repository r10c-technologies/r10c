import { Effect, Metric } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  busEventsConsumed,
  busEventsFailed,
  busEventsPublished,
  busPublishFailures,
  recordConsumed,
  recordFailed,
  recordPublished,
  recordPublishFailure,
  type SubscriptionTags,
} from './bus-metrics.js';

/**
 * Reads a counter straight out of Effect's registry.
 *
 * The metric objects are imported rather than rebuilt by name, and that is the
 * trap this spec would otherwise fall into: an Effect metric's registry key
 * includes its **description**, so `Metric.counter('bus_events_published_total')`
 * written out here would address a different series that is permanently zero.
 *
 * Every assertion reads a delta. The registry is a process-wide singleton —
 * which is exactly why an increment in the adapter's detached settle fiber is
 * exported at all — so an absolute would couple this spec to whatever else ran
 * in the same worker.
 */
const readCounter = (
  metric: Metric.Metric.Counter<number>,
  tags: Record<string, string>,
) =>
  Effect.runPromise(
    Metric.value(
      Object.entries(tags).reduce(
        (tagged, [key, value]) => Metric.tagged(tagged, key, value),
        metric,
      ),
    ).pipe(Effect.map(state => state.count)),
  );

const WORK: SubscriptionTags = {
  queue: 'transaction.transaction._star_',
  slice: 'transaction',
  mode: 'work',
};

const tagsOf = (subscription: SubscriptionTags) => ({
  queue: subscription.queue,
  slice: subscription.slice,
  mode: subscription.mode,
});

describe('bus metrics', () => {
  it('counts a published event under its own name', async () => {
    const tags = { event: 'transaction.completed' };
    const before = await readCounter(busEventsPublished, tags);

    await Effect.runPromise(recordPublished('transaction.completed'));

    expect(await readCounter(busEventsPublished, tags)).toBe(before + 1);
  });

  it('counts a refused publish separately from a successful one', async () => {
    const tags = { event: 'catalog.published' };
    const succeeded = await readCounter(busEventsPublished, tags);
    const refused = await readCounter(busPublishFailures, tags);

    await Effect.runPromise(recordPublishFailure('catalog.published'));

    // A broker outage must move the failure count and leave the published count
    // flat. One counter for both would make "the broker is down" and "nothing
    // is being published" the same series.
    expect(await readCounter(busPublishFailures, tags)).toBe(refused + 1);
    expect(await readCounter(busEventsPublished, tags)).toBe(succeeded);
  });

  it('counts a consumed delivery by subscription', async () => {
    const before = await readCounter(busEventsConsumed, tagsOf(WORK));

    await Effect.runPromise(recordConsumed(WORK));

    expect(await readCounter(busEventsConsumed, tagsOf(WORK))).toBe(before + 1);
  });

  it('separates a poison delivery from a transient one', async () => {
    // The two get different treatment — a poison message is quarantined with
    // zero retries, a transient one is requeued — so folding them into one
    // count hides the distinction the whole failure vocabulary exists to draw.
    const poisonTags = { ...tagsOf(WORK), failure: 'poison' };
    const transientTags = { ...tagsOf(WORK), failure: 'transient' };
    const poison = await readCounter(busEventsFailed, poisonTags);
    const transient = await readCounter(busEventsFailed, transientTags);

    await Effect.runPromise(recordFailed(WORK, 'poison'));

    expect(await readCounter(busEventsFailed, poisonTags)).toBe(poison + 1);
    expect(await readCounter(busEventsFailed, transientTags)).toBe(transient);
  });

  it('keeps two subscriptions on one pattern apart', async () => {
    // The tracker's fold and the SSE hub both bind `transaction.*`. Tagged by
    // pattern alone they would share a series, and a broadcast consumer that
    // had stopped acking would be invisible behind the work consumer's traffic.
    const broadcast: SubscriptionTags = {
      queue: 'amq.gen-Xy1',
      slice: 'transaction',
      mode: 'broadcast',
    };
    const workBefore = await readCounter(busEventsConsumed, tagsOf(WORK));
    const broadcastBefore = await readCounter(
      busEventsConsumed,
      tagsOf(broadcast),
    );

    await Effect.runPromise(recordConsumed(broadcast));

    expect(await readCounter(busEventsConsumed, tagsOf(broadcast))).toBe(
      broadcastBefore + 1,
    );
    expect(await readCounter(busEventsConsumed, tagsOf(WORK))).toBe(workBefore);
  });
});
