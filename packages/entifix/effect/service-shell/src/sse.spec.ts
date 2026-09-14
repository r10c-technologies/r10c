import type { DomainEvent } from '@r10c/entifix-ts-core';
import { Chunk, Effect, Stream, TestClock, TestContext } from 'effect';
import { describe, expect, it } from 'vitest';

import { sseFrame, sseResponse } from './sse.js';

const event = (id: string): DomainEvent<{ entity: string }> => ({
  name: 'transaction.completed',
  id,
  source: 'marketplace-admin',
  at: '2026-09-02T00:00:00.000Z',
  correlationId: id.split(':')[0],
  data: { entity: 'product-specification' },
});

/** The frames a response would put on the wire, as text. */
const framesOf = (response: ReturnType<typeof sseResponse>) => {
  const body = response.body;
  /* v8 ignore next 3 -- `sseResponse` always builds a stream body; this
     narrows the `HttpBody` union rather than guarding a reachable case. */
  if (body._tag !== 'Stream') {
    throw new Error(`expected a stream body, got ${body._tag}`);
  }
  return Stream.map(body.stream, (bytes: Uint8Array) =>
    new TextDecoder().decode(bytes),
  );
};

// The response body's stream carries the platform's own error channel, which a
// spec has no way to inhabit; `orDie` narrows it rather than widening every
// assertion below into an `Either`.
const run = <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> =>
  Effect.runPromise(Effect.orDie(effect));

describe('sseFrame', () => {
  it('carries the message id and a full event envelope', () => {
    expect(sseFrame(event('txn-1:completed'))).toBe(
      'id: txn-1:completed\n' +
        'data: {"meta":{"type":"event","event":{"name":"transaction.completed",' +
        '"id":"txn-1:completed","source":"marketplace-admin",' +
        '"at":"2026-09-02T00:00:00.000Z","correlationId":"txn-1"}},' +
        '"data":{"entity":"product-specification"}}\n\n',
    );
  });
});

describe('sseResponse', () => {
  it('answers text/event-stream, uncacheable and unbuffered', () => {
    const response = sseResponse(Stream.empty);

    expect(response.headers['content-type']).toBe('text/event-stream');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-accel-buffering']).toBe('no');
  });

  it('encodes each event as a frame and ends with the source stream', async () => {
    const body = await run(
      Stream.runCollect(
        framesOf(
          sseResponse(Stream.make(event('a:accepted'), event('a:completed'))),
        ),
      ).pipe(
        Effect.map(chunk => Chunk.toReadonlyArray(chunk).join('')),
        Effect.provide(TestContext.TestContext),
      ),
    );

    // Opens immediately: a chunked response writes its headers with its first
    // chunk, so a silent stream never reaches the client at all.
    expect(body.startsWith(': open\n\n')).toBe(true);
    expect(body).toContain('id: a:accepted\n');
    expect(body).toContain('id: a:completed\n');
    expect(body).not.toContain('keepalive');
  });

  // A connection silent for minutes is indistinguishable from a dead one to
  // anything in between, and an intermediary that decides it is dead closes it
  // with no error either side can report.
  it('emits a keepalive comment while the source is idle', async () => {
    const first = Effect.gen(function* () {
      const reading = yield* Effect.fork(
        Stream.runCollect(
          Stream.take(Stream.drop(framesOf(sseResponse(Stream.never)), 1), 1),
        ),
      );
      yield* TestClock.adjust('25 seconds');
      return Chunk.toReadonlyArray(yield* reading);
    });

    expect(
      await run(first.pipe(Effect.provide(TestContext.TestContext))),
    ).toEqual([': keepalive\n\n']);
  });

  // The bound every REST route gets implicitly: verification is stateless, so
  // the next call after `exp` fails. A held-open response has no next call, so
  // it has to close itself (ADR 0036).
  it('closes the connection when the token expires', async () => {
    const closing = Effect.gen(function* () {
      const reading = yield* Effect.fork(
        Stream.runDrain(
          framesOf(
            sseResponse(Stream.never, { expiresAt: 1000, now: () => 100_000 }),
          ),
        ),
      );
      yield* TestClock.adjust('16 minutes');
      return yield* reading;
    });

    // Terminates rather than hanging — the assertion is that this resolves.
    await expect(
      run(closing.pipe(Effect.provide(TestContext.TestContext))),
    ).resolves.toBeUndefined();
  });

  it('closes at once for a token that already expired', async () => {
    const drained = Stream.runCollect(
      framesOf(sseResponse(Stream.never, { expiresAt: 1, now: () => 100_000 })),
    );

    // The opening comment and nothing else: the client learns the connection
    // exists and that it is over, rather than being left in `CONNECTING`.
    expect(
      await run(
        drained.pipe(
          Effect.map(Chunk.toReadonlyArray),
          Effect.provide(TestContext.TestContext),
        ),
      ),
    ).toEqual([': open\n\n']);
  });
});
