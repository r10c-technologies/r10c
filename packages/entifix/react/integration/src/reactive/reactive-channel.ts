import type { DomainEvent, EntityChangeEvent } from '@r10c/entifix-ts-core';
import { Context } from 'effect';

export type { EntityChangeEvent };

/**
 * A listener on the reactive stream.
 *
 * It receives the whole message, not just the payload: the transaction id, the
 * emission time and the sequence a consumer needs are `meta.event.correlationId`,
 * `.at` and `.id`, and duplicating them onto {@link EntityChangeEvent} is how
 * two sources of one fact drift (ADR 0036). `#137` settles an optimistic write
 * on the correlation id; `useReactiveInvalidation` reads only `data.entity`.
 */
export type EntityChangeListener = (
  event: DomainEvent<EntityChangeEvent>,
) => void;

/**
 * The reactive-updates port. Framework-free on purpose (like the OTel tooling):
 * the transport is swappable, and the React side wires `subscribe` to the query
 * client. `subscribe` returns its own unsubscribe.
 */
export interface ReactiveChannel {
  subscribe(listener: EntityChangeListener): () => void;
  /**
   * Runs whenever the stream is (re)connected — and **immediately if it is
   * already connected when the listener registers**.
   *
   * The stream does not replay, by design (ADR 0036), so a consumer that missed
   * an outcome while disconnected has to go and ask. This is the signal that
   * tells it when to: `#137` re-queries every pending transaction id here.
   *
   * ⚠️ **The replay is the mechanism, not a convenience.** The channel is
   * refcounted and opened by its *first* subscriber, and
   * `useReactiveInvalidation` typically is that subscriber. A consumer mounting
   * after it — which depends on nothing more than component-tree ordering —
   * would otherwise register for an open that had already happened, and
   * reconcile nothing until the next real network drop. On a page load with no
   * disconnect, a pending set restored from the previous session would never be
   * reconciled at all, which is the case this exists for.
   *
   * Required rather than optional: an optional member on a port is how one
   * implementation quietly stops honouring it while every consumer compiles.
   */
  onConnect(listener: () => void): () => void;
}

export class ReactiveChannelTag extends Context.Tag('ReactiveChannel')<
  ReactiveChannelTag,
  ReactiveChannel
>() {}

/**
 * A channel that never emits — the default until a transport is provided.
 *
 * It never connects either, so `onConnect` registers nothing: a consumer of this
 * channel reconciles never, which is the honest behaviour for a transport that
 * is not there.
 */
export const NoopReactiveChannel: ReactiveChannel = {
  subscribe: () => () => undefined,
  onConnect: () => () => undefined,
};

export interface InMemoryReactiveChannel extends ReactiveChannel {
  /** Push an event to every current subscriber (drives tests and the mock). */
  emit(event: DomainEvent<EntityChangeEvent>): void;
  /**
   * Announce a (re)connection, so a spec can drive the reconciliation path.
   *
   * Also flips this channel to "connected", which is what makes a listener
   * registered afterwards fire immediately — the behaviour the real transport
   * has and the one most likely to be got wrong.
   */
  connect(): void;
}

/**
 * A synchronous in-memory channel: `emit` fans out to every live subscriber.
 *
 * It backs specs. It is no longer what the workspace runs on — that is
 * `makeEventSourceReactiveChannel`, and until ADR 0036 landed a transport this
 * one was mounted in its place, emitting nothing, so a reader of the workspace
 * could not tell "the transport is missing" from "nothing changed".
 */
export function makeInMemoryReactiveChannel(): InMemoryReactiveChannel {
  const listeners = new Set<EntityChangeListener>();
  const connectListeners = new Set<() => void>();
  let connected = false;
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onConnect(listener) {
      connectListeners.add(listener);
      // Mirrors the real transport: a listener arriving after the connection is
      // already up must not wait for the next drop to hear about it.
      if (connected) listener();
      return () => {
        connectListeners.delete(listener);
      };
    },
    connect() {
      connected = true;
      for (const listener of connectListeners) {
        listener();
      }
    },
    emit(event) {
      for (const listener of listeners) {
        listener(event);
      }
    },
  };
}
