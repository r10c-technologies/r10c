import { Effect, Logger, LogLevel } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeInMemoryObservabilityLayer } from './observability';

/**
 * The Effect → tooling logger bridge, asserted at the two points where it was
 * silently wrong.
 *
 * The existing e2e (`logging.mock.spec.ts`) checks that records are structured
 * and trace-correlated, and it passed throughout: its level assertion is
 * `expect(['debug','info','warn','error']).toContain(record.level)`, which
 * every record satisfied precisely because every record was `info`. An
 * assertion that admits all four values cannot see a mapper that only ever
 * returns one, so the level is pinned per level here instead.
 */
const runLogging = async <A>(effect: Effect.Effect<A>) => {
  const observability = makeInMemoryObservabilityLayer('@r10c/spec-service');
  await Effect.runPromise(
    effect.pipe(
      // Effect's own minimum is `Info`, so a `logDebug` is dropped before any
      // logger sees it — independent of the tooling logger's `level`, which the
      // in-memory layer already sets to `debug`. Both have to be lowered, and a
      // spec that only set the second would report the bridge as losing a debug
      // record it was never handed.
      Logger.withMinimumLogLevel(LogLevel.Debug),
      Effect.provide(observability.layer),
    ),
  );
  return observability.logRecords;
};

describe('the Effect log bridge', () => {
  // Effect's labels are upper case (`"ERROR"`, `"WARN"`, `"DEBUG"`), and the
  // mapper used to switch on `'Error'`/`'Warning'`/`'Debug'` — no case could
  // match, so everything fell through to `info`. An `Effect.logError` reaching
  // a sink as INFO is invisible to every level-based alert while still being
  // present in the log, which reads as "the service has no errors".
  it.each([
    ['error', Effect.logError('boom'), 17],
    ['warn', Effect.logWarning('careful'), 13],
    ['info', Effect.logInfo('hello'), 9],
    ['debug', Effect.logDebug('noisy'), 5],
  ])(
    'maps %s to its own level and severity',
    async (level, effect, severity) => {
      const records = await runLogging(effect);

      const record = records.at(-1);
      expect(record?.level).toBe(level);
      expect(record?.severityNumber).toBe(severity);
    },
  );

  // `annotations` used to be destructured away and never forwarded, so every
  // `Effect.annotateLogs` in every service was discarded before a sink saw it —
  // including the transaction id on a failed compensation and the tenant
  // database on a quarantined outbox entry.
  it('forwards annotations as structured attributes', async () => {
    const records = await runLogging(
      Effect.logError('transaction rollback failed').pipe(
        Effect.annotateLogs({
          transactionId: 'tx-1',
          entity: 'product-specification',
          attempts: 3,
          quarantined: true,
        }),
      ),
    );

    expect(records.at(-1)?.attributes).toMatchObject({
      transactionId: 'tx-1',
      entity: 'product-specification',
      attempts: 3,
      quarantined: true,
    });
  });

  // The attribute values are a closed scalar set, so a non-scalar annotation is
  // stringified rather than dropped: a field that reads `[object Object]` still
  // tells an operator it was set, where a missing one is indistinguishable from
  // never having been annotated at all.
  it('stringifies an annotation that is not a scalar', async () => {
    const records = await runLogging(
      Effect.logInfo('shaped').pipe(
        Effect.annotateLogs({ where: { deep: true } }),
      ),
    );

    expect(typeof records.at(-1)?.attributes.where).toBe('string');
  });

  it('keeps a log with no annotations free of extra attributes', async () => {
    const records = await runLogging(Effect.logInfo('bare'));

    expect(records.at(-1)?.attributes).toEqual({});
  });
});
