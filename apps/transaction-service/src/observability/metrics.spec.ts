import { Effect, Metric } from 'effect';
import { describe, expect, it } from 'vitest';

import { recordTransactionStates, transactionsByState } from './metrics.js';

/**
 * Reads a gauge out of Effect's registry.
 *
 * The metric objects are imported rather than rebuilt by name: a metric's
 * registry key includes its description, so writing `Metric.gauge('...')` out
 * again here would read a different series that is permanently zero.
 */
const readGauge = (
  metric: Metric.Metric.Gauge<number>,
  tags: Record<string, string>,
) =>
  Effect.runPromise(
    Metric.value(
      Object.entries(tags).reduce(
        (tagged, [key, value]) => Metric.tagged(tagged, key, value),
        metric,
      ),
    ).pipe(Effect.map(state => state.value)),
  );

describe('recordTransactionStates', () => {
  it('reports every state, including the ones at zero', async () => {
    await Effect.runPromise(
      recordTransactionStates({
        PENDING: 2,
        COMPLETED: 40,
        FAILED: 1,
        STALE: 0,
      }),
    );

    expect(await readGauge(transactionsByState, { state: 'PENDING' })).toBe(2);
    expect(await readGauge(transactionsByState, { state: 'COMPLETED' })).toBe(
      40,
    );
    expect(await readGauge(transactionsByState, { state: 'FAILED' })).toBe(1);
    // Zero rather than an absent series: `STALE` dropping to none must not look
    // the same as the metric having broken.
    expect(await readGauge(transactionsByState, { state: 'STALE' })).toBe(0);
  });

  it('overwrites rather than accumulating, because it is a gauge', async () => {
    await Effect.runPromise(
      recordTransactionStates({
        PENDING: 5,
        COMPLETED: 0,
        FAILED: 0,
        STALE: 0,
      }),
    );
    await Effect.runPromise(
      recordTransactionStates({
        PENDING: 1,
        COMPLETED: 0,
        FAILED: 0,
        STALE: 0,
      }),
    );

    // A counter here would make a backlog that had cleared read as a backlog
    // that had doubled.
    expect(await readGauge(transactionsByState, { state: 'PENDING' })).toBe(1);
  });
});
