import type { OutboxStats } from '@r10c/entifix-transactions';
import { Effect, Metric } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  outboxOldestPendingAge,
  outboxPending,
  outboxQuarantined,
  recordOutboxStats,
  recordTransactionStates,
  transactionsByState,
} from './metrics';

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

const stats = (overrides: Partial<OutboxStats> = {}): OutboxStats => ({
  pending: 0,
  quarantined: 0,
  ...overrides,
});

describe('recordOutboxStats', () => {
  it('reports depth and quarantine per database', async () => {
    const database = 'tenant_acme';

    await Effect.runPromise(
      recordOutboxStats(database, stats({ pending: 7, quarantined: 2 })),
    );

    expect(await readGauge(outboxPending, { database })).toBe(7);
    expect(await readGauge(outboxQuarantined, { database })).toBe(2);
  });

  it('derives the oldest entry’s age in seconds', async () => {
    const database = 'tenant_age';
    const thirtySecondsAgo = new Date(Date.now() - 30_000).toISOString();

    await Effect.runPromise(
      recordOutboxStats(
        database,
        stats({ pending: 1, oldestPendingAt: thirtySecondsAgo }),
      ),
    );

    // A depth that is flat while this climbs is the signature of a relay whose
    // head has stopped moving — the whole reason the age is reported at all.
    expect(
      await readGauge(outboxOldestPendingAge, { database }),
    ).toBeGreaterThanOrEqual(29);
    expect(await readGauge(outboxOldestPendingAge, { database })).toBeLessThan(
      35,
    );
  });

  it('reports an age of zero for an empty outbox rather than nothing', async () => {
    const database = 'tenant_empty';

    await Effect.runPromise(recordOutboxStats(database, stats()));

    // Not reporting the series would read on most dashboards as "no data",
    // which is indistinguishable from the exporter having broken at exactly the
    // moment a healthy relay looks idle.
    expect(await readGauge(outboxOldestPendingAge, { database })).toBe(0);
  });

  it('never reports a negative age for a clock skewed forward', async () => {
    const database = 'tenant_skew';
    const future = new Date(Date.now() + 60_000).toISOString();

    await Effect.runPromise(
      recordOutboxStats(
        database,
        stats({ pending: 1, oldestPendingAt: future }),
      ),
    );

    expect(await readGauge(outboxOldestPendingAge, { database })).toBe(0);
  });

  it('keeps two tenant databases apart', async () => {
    await Effect.runPromise(
      recordOutboxStats('tenant_a', stats({ pending: 3 })),
    );
    await Effect.runPromise(
      recordOutboxStats('tenant_b', stats({ pending: 9 })),
    );

    // Untagged, one busy tenant would mask every other tenant's stuck relay.
    expect(await readGauge(outboxPending, { database: 'tenant_a' })).toBe(3);
    expect(await readGauge(outboxPending, { database: 'tenant_b' })).toBe(9);
  });
});

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
