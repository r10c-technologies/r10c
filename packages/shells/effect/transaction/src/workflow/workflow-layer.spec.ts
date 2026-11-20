import { makeFakeSqlClient } from '@entifix/testing-unit/drivers';
import {
  BulkheadTag,
  CircuitBreakerTag,
  DEFAULT_BREAKER_DIALS,
  OutboxTag,
} from '@entifix/transactions';
import { Duration, Effect, Layer, Logger, References } from 'effect';
import { SqlClient } from 'effect/sql';
import { describe, expect, it } from 'vitest';

import type { ForcedState, ParticipantDials } from './participant-dials.js';
import {
  interpreterOptions,
  journalRetention,
  logJournalPurge,
  participantGuardsLayer,
  runnerPort,
  SqlOutboxLayer,
} from './workflow-layer.js';

const dialsOf = (forcedState: ForcedState): ParticipantDials => ({
  breaker: DEFAULT_BREAKER_DIALS,
  forcedState,
  bulkheadPermits: 2,
  bounds: { attemptTimeoutMs: 10, stepTimeoutMs: 20 },
});

describe('a runner’s port', () => {
  it('is the service port + 31000 + 1000 × the replica', () => {
    expect([runnerPort(3103, 0), runnerPort(3103, 1)]).toEqual([34103, 35103]);
  });
});

describe('the participants’ guards', () => {
  it('applies each forced state at boot, and leaves a closed one to its window', async () => {
    const states = await Effect.runPromise(
      Effect.flatMap(CircuitBreakerTag, breaker =>
        Effect.all([
          breaker.state('stock-service'),
          breaker.state('order-service'),
          breaker.state('payment-service'),
        ]),
      ).pipe(
        Effect.provide(
          participantGuardsLayer({
            'stock-service': dialsOf('forcedOpen'),
            'order-service': dialsOf('disabled'),
            'payment-service': dialsOf('closed'),
          }),
        ),
      ),
    );

    expect(states).toEqual(['forcedOpen', 'disabled', 'closed']);
  });

  it('lets a participant through on its own permits and its own window', async () => {
    const answered = await Effect.runPromise(
      Effect.gen(function* () {
        const breaker = yield* CircuitBreakerTag;
        const bulkhead = yield* BulkheadTag;
        return yield* breaker.guard('payment-service')(
          bulkhead.withPermit('payment-service')(Effect.succeed('answered')),
        );
      }).pipe(
        Effect.provide(
          participantGuardsLayer({ 'payment-service': dialsOf('closed') }),
        ),
      ),
    );

    expect(answered).toBe('answered');
  });
});

describe('the interpreter’s options', () => {
  it('bounds a participant by its own rows, and leaves an unknown one to the defaults', () => {
    const options = interpreterOptions(
      { 'stock-service': dialsOf('closed') },
      4,
    );

    expect([options.source, options.dials]).toEqual([
      'transaction',
      { concurrency: 4 },
    ]);
    expect(options.dialsFor?.('stock-service')).toEqual({
      attemptTimeoutMs: 10,
      stepTimeoutMs: 20,
    });
    expect(options.dialsFor?.('courier-service')).toBeUndefined();
  });
});

describe('the workflow outbox', () => {
  it('ensures its tables before it is handed out', async () => {
    const fake = makeFakeSqlClient();

    const outbox = await Effect.runPromise(
      Effect.service(OutboxTag).pipe(
        Effect.provide(
          SqlOutboxLayer.pipe(
            Layer.provide(
              Layer.succeed(SqlClient.SqlClient, fake.client as never),
            ),
          ),
        ),
      ),
    );

    expect(typeof outbox.enqueue).toBe('function');
    // entifix 0.23.4 serialises the creation behind an advisory lock (#733),
    // so a second runner booting at once waits rather than racing the CREATE.
    const statements = fake.executions.map(execution => execution.sql);
    expect(statements.slice(0, 2)).toEqual([
      'BEGIN',
      'SELECT pg_advisory_xact_lock(hashtext($1))',
    ]);
    expect(statements[2]).toContain('CREATE TABLE IF NOT EXISTS');
  });
});

describe('the journal’s retention', () => {
  it('is the row, in milliseconds, and logs each pass through the shell', () => {
    const retention = journalRetention(2_592_000_000);

    expect(retention.journalRetention).toEqual(Duration.millis(2_592_000_000));
    expect(retention.onPurge).toBe(logJournalPurge);
  });

  it('logs a pass that purged quietly, and one that failed as an error', async () => {
    const levels: string[] = [];
    const capture = Logger.make(({ logLevel, message }) => {
      levels.push(`${logLevel}:${String((message as unknown[])[0])}`);
    });

    await Effect.runPromise(
      Effect.all([
        logJournalPurge({ _tag: 'purged', flows: 3 }),
        logJournalPurge({ _tag: 'purgeFailed', failure: new Error('down') }),
      ]).pipe(
        Effect.provide(Logger.layer([capture])),
        Effect.provideService(References.MinimumLogLevel, 'All'),
      ),
    );

    expect(levels).toEqual(['Debug:purged', 'Error:purgeFailed']);
  });
});
