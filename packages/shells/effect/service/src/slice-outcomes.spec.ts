import { EntifixConnError, Unavailable } from '@entifix/core';
import { Effect, Logger, References } from 'effect';
import { describe, expect, it } from 'vitest';

import { failureFacts, logSliceOutcome } from './slice-outcomes.js';

interface Captured {
  readonly level: string;
  readonly message: unknown;
  readonly annotations: Record<string, unknown>;
}

const capture = async (
  effect: Effect.Effect<void>,
): Promise<Captured | undefined> => {
  const records: Captured[] = [];
  await Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Logger.layer([
          Logger.make(({ logLevel, message, fiber }) => {
            records.push({
              level: logLevel,
              message,
              annotations: {
                ...fiber.getRef(References.CurrentLogAnnotations),
              },
            });
          }),
        ]),
      ),
      Effect.provideService(References.MinimumLogLevel, 'All'),
    ),
  );
  return records[0];
};

describe('failureFacts', () => {
  it('names a typed failure by its code and category', () => {
    expect(failureFacts(new Unavailable({ dependency: 'mongo' }))).toEqual({
      code: 'unavailable',
      category: 'unavailable',
    });
  });

  it('names anything else internal, and carries none of its text', () => {
    const facts = failureFacts(new EntifixConnError('password hunter2'));

    expect(facts).toEqual({ code: 'internal', category: 'internal' });
    expect(JSON.stringify(facts)).not.toContain('hunter2');
  });
});

describe('logSliceOutcome', () => {
  it('logs at the level asked, with the fields and the failure facts', async () => {
    const record = await capture(
      logSliceOutcome(
        'Error',
        'a sweep failed',
        { sweep: 'reservations' },
        new Unavailable({}),
      ),
    );

    expect(record?.level).toBe('Error');
    expect(record?.annotations).toEqual({
      sweep: 'reservations',
      code: 'unavailable',
      category: 'unavailable',
    });
  });

  it('adds no failure facts to an outcome that carries no failure', async () => {
    const record = await capture(
      logSliceOutcome('Info', 'settled a period', { payouts: 2 }),
    );

    expect(record?.annotations).toEqual({ payouts: 2 });
  });

  it('names the trace the outcome was reached under', async () => {
    const record = await capture(
      logSliceOutcome('Debug', 'held', {}).pipe(Effect.withSpan('spec')),
    );

    expect(typeof record?.annotations['traceId']).toBe('string');
  });
});
