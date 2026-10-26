import { EntifixConnError } from '@entifix/core';
import type {
  TransactionRecord,
  TransactionStore,
} from '@entifix/transactions';
import { Effect, Logger, References } from 'effect';
import { describe, expect, it } from 'vitest';

import { sweepStale } from './tracking';

const STALE_TIMEOUT_MS = 60_000;

const aRecord = (transactionId: string): TransactionRecord => ({
  transactionId,
  entity: 'product-specification',
  state: 'PENDING',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  organizationId: 'demo-organization',
});

/**
 * A store that records what the sweep did to it. `findStale` returns the same
 * batch every call — one pass is what a spec asserts on.
 */
const recordingStore = (stale: readonly TransactionRecord[]) => {
  const marked: string[] = [];

  const store: TransactionStore = {
    upsertFromEvent: () => Effect.die('not used'),
    get: () => Effect.succeed(undefined),
    findStale: () => Effect.succeed(stale),
    markStale: transactionId =>
      Effect.sync(() => {
        marked.push(transactionId);
      }),
    countByState: () =>
      Effect.succeed({
        PENDING: stale.length,
        COMPLETED: 0,
        FAILED: 0,
        STALE: 0,
      }),
  };

  return { store, marked };
};

/** A store whose `findStale` cannot run — the case that used to vanish. */
const failingStore = (message: string): TransactionStore => ({
  upsertFromEvent: () => Effect.die('not used'),
  get: () => Effect.succeed(undefined),
  findStale: () => Effect.fail(new EntifixConnError(message)),
  markStale: () => Effect.void,
  countByState: () => Effect.fail(new EntifixConnError(message)),
});

/** Runs one sweep and returns the log records it emitted. */
const runSweep = async (store: TransactionStore) => {
  const logs: Array<{
    message: string;
    level: string;
    annotations: Record<string, unknown>;
  }> = [];

  await Effect.runPromise(
    sweepStale(store, STALE_TIMEOUT_MS).pipe(
      Effect.provide(
        Logger.layer([
          Logger.make(({ logLevel, message, fiber }) => {
            logs.push({
              message: String(message),
              level: logLevel,
              annotations: {
                ...fiber.getRef(References.CurrentLogAnnotations),
              },
            });
          }),
        ]),
      ),
    ),
  );

  return logs;
};

describe('sweepStale', () => {
  it('marks every stale record and says nothing when the pass succeeds', async () => {
    const { store, marked } = recordingStore([
      aRecord('tx-1'),
      aRecord('tx-2'),
    ]);

    const logs = await runSweep(store);

    expect(marked).toEqual(['tx-1', 'tx-2']);
    expect(logs).toEqual([]);
  });

  it('is a no-op on an empty sweep', async () => {
    const { store, marked } = recordingStore([]);

    const logs = await runSweep(store);

    expect(marked).toEqual([]);
    expect(logs).toEqual([]);
  });

  it('reports a failed pass instead of swallowing it', async () => {
    // The regression this guards: the handler was `() => Effect.void`, so a
    // sweep that could not query produced no record anywhere and recovery
    // silently stopped happening while the daemon went on looping.
    const logs = await runSweep(failingStore('connection closed'));

    expect(logs).toHaveLength(1);
    expect(logs[0]?.message).toBe('saga recovery sweep failed');
    // The level matters as much as the message. The service's logger bridge
    // keys its mapping off exactly this value — Effect's own `LogLevel` — and a
    // sweep failure arriving as INFO is invisible to any level-based alert while
    // still being present in the log.
    expect(logs[0]?.level).toBe('Error');
    // Structured, not interpolated: the reason has to be queryable rather than
    // parsed back out of a rendered string.
    expect(logs[0]?.annotations['error']).toContain('connection closed');
  });

  it('never fails, so the daemon that repeats it cannot die', async () => {
    const outcome = await Effect.runPromise(
      Effect.result(sweepStale(failingStore('connection closed'), 1)),
    );

    expect(outcome._tag).toBe('Success');
  });
});
