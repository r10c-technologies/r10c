import {
  type EntityChangeEvent,
  readEventEnvelope,
} from '@r10c/entifix-ts-core';
import { Effect, Either } from 'effect';

import type { EntityChangeListener, ReactiveChannel } from './reactive-channel';

/**
 * The reactive stream's browser end: one `EventSource` over a same-origin URL.
 *
 * **Same-origin is the whole reason this is SSE and not a WebSocket.** `r10c_at`
 * is `httpOnly` and `sameSite: 'lax'`, and the `WebSocket` constructor accepts
 * no headers — so a socket would need a second class of bearer token handed to
 * client JavaScript, which is the one thing `httpOnly` protects against. An
 * `EventSource` against the app's own proxy path sends the cookie the way every
 * other call in the repo does (ADR 0036).
 *
 * What it also gets for free is the half #137 would otherwise hand-write:
 * `EventSource` reconnects on its own with backoff and re-sends `Last-Event-ID`.
 * The server accepts that header and ignores it — the stream is a hint that
 * something changed, and the record behind it is the truth.
 *
 * The connection is opened lazily on the first subscriber and closed with the
 * last, so a page that mounts no workspace holds none. One connection per URL,
 * not one per listener: SSE shares the origin's HTTP/1.1 connection budget.
 */
export function makeEventSourceReactiveChannel(url: string): ReactiveChannel {
  const listeners = new Set<EntityChangeListener>();
  const connectListeners = new Set<() => void>();
  let source: EventSource | undefined;
  // Tracked here rather than read off `source.readyState`, because it must
  // survive the close/reopen cycle the refcount drives: what a reconciling
  // consumer needs to know is "has this channel been connected", not "is this
  // particular `EventSource` object open right now".
  let connected = false;

  const deliver = (raw: string): void => {
    // A frame this build cannot read is dropped rather than thrown: `onmessage`
    // runs inside the browser's event loop, where a throw reaches no caller and
    // would take the rest of this delivery's listeners with it.
    const parsed = Effect.runSync(
      Effect.either(
        Effect.flatMap(
          Effect.try(() => JSON.parse(raw) as unknown),
          readEventEnvelope<EntityChangeEvent>,
        ),
      ),
    );
    if (Either.isLeft(parsed)) {
      return;
    }

    for (const listener of listeners) {
      listener(parsed.right);
    }
  };

  const open = (): void => {
    // Guarded because a server-rendered pass has no `EventSource` at all, and a
    // channel built at module scope must not throw there.
    if (source !== undefined || typeof EventSource === 'undefined') {
      return;
    }
    source = new EventSource(url);
    source.onmessage = message => {
      deliver(message.data as string);
    };
    // Fires on the first open *and* on every browser-driven reconnect, because
    // `EventSource` reconnects the same object rather than handing back a new
    // one — so nothing has to re-arm this.
    source.onopen = () => {
      connected = true;
      for (const listener of connectListeners) {
        listener();
      }
    };
  };

  const close = (): void => {
    source?.close();
    source = undefined;
    connected = false;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      open();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          close();
        }
      };
    },
    onConnect(listener) {
      connectListeners.add(listener);
      // ⚠️ The replay, and the reason this signal works at all. Registering does
      // *not* open the connection — subscribing is what does that — so a
      // consumer arriving after another one opened the stream would otherwise
      // wait for a network drop that may never come, and a restored pending set
      // would never be reconciled.
      if (connected) listener();
      return () => {
        connectListeners.delete(listener);
      };
    },
  };
}
