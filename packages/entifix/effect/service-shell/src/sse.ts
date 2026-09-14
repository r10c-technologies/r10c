import { HttpServerResponse } from '@effect/platform';
import { type DomainEvent, makeEventEnvelope } from '@r10c/entifix-ts-core';
import { Duration, Effect, Stream } from 'effect';

/**
 * How often an idle connection emits a comment frame.
 *
 * An SSE connection that sends nothing for minutes is indistinguishable from a
 * dead one to anything between the browser and the service, and a proxy that
 * decides it is dead closes it with no error either side can report. A comment
 * (`:` and nothing else) is ignored by `EventSource` and costs three bytes.
 */
const KEEPALIVE = Duration.seconds(20);

const encoder = new TextEncoder();

/**
 * One `EventSource` frame.
 *
 * `id:` carries the message's own id — `<transactionId>:<step>` for a
 * transaction event — so the `Last-Event-ID` a browser re-sends on reconnect
 * names a message that actually exists, rather than a counter invented for the
 * wire. The server does not replay it (ADR 0036); the client reconciles by
 * re-reading the record.
 *
 * `data:` is a full `event` envelope, which is what keeps the stream from
 * becoming a fourth framing: the same bytes a bus consumer would read.
 */
export const sseFrame = (event: DomainEvent): string =>
  `id: ${event.id}\ndata: ${JSON.stringify(makeEventEnvelope(event))}\n\n`;

export interface SseResponseOptions {
  /**
   * Unix seconds at which to close the connection — the verified token's `exp`.
   *
   * A held-open response has no next request to fail verification, so the bound
   * every REST route gets implicitly has to be applied explicitly here. The
   * browser reconnects with the cookie the app refreshed in the meantime
   * (ADR 0036). Omitted, the stream runs until the client goes away.
   */
  readonly expiresAt?: number;
  /** Injectable for tests; defaults to the wall clock. */
  readonly now?: () => number;
}

/**
 * Serves a stream of domain events as `text/event-stream`.
 *
 * `cache-control: no-store` is not politeness — a cached event stream is served
 * to whoever asks next, and this one is scoped to a single principal. The
 * response is deliberately *not* rebuilt anywhere downstream: the Next proxy has
 * a pass-through arm for exactly this content type, because reading the body to
 * completion first holds the request open forever and delivers nothing.
 */
export const sseResponse = (
  events: Stream.Stream<DomainEvent>,
  { expiresAt, now = Date.now }: SseResponseOptions = {},
): HttpServerResponse.HttpServerResponse => {
  const keepalive = Stream.repeatEffect(
    Effect.as(Effect.sleep(KEEPALIVE), ': keepalive\n\n'),
  );

  const frames = Stream.merge(Stream.map(events, sseFrame), keepalive, {
    haltStrategy: 'left',
  });

  // An opening comment, emitted before anything has happened.
  //
  // Not cosmetic: a chunked response writes its headers with its first chunk,
  // so a stream that stays silent until something occurs leaves the client in
  // `CONNECTING` — indefinitely, since a stream whose whole purpose is to be
  // idle most of the time may have nothing to say for hours. Measured: without
  // it, `fetch` against this route does not resolve at all.
  const opened = Stream.concat(Stream.make(': open\n\n'), frames);

  const bounded =
    expiresAt === undefined
      ? opened
      : Stream.interruptWhen(
          opened,
          // Never negative: an already-expired token closes at once rather than
          // scheduling a sleep into the past, which `Effect.sleep` treats as
          // zero anyway but reads as an oversight.
          Effect.sleep(Duration.millis(Math.max(0, expiresAt * 1000 - now()))),
        );

  return HttpServerResponse.stream(
    Stream.map(bounded, frame => encoder.encode(frame)),
    {
      contentType: 'text/event-stream',
      headers: {
        'cache-control': 'no-store',
        connection: 'keep-alive',
        // nginx buffers a proxied response by default, which would hold every
        // frame until the stream ends — that is, forever.
        'x-accel-buffering': 'no',
      },
    },
  );
};
