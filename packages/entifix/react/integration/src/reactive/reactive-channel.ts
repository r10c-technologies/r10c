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
}

export class ReactiveChannelTag extends Context.Tag('ReactiveChannel')<
  ReactiveChannelTag,
  ReactiveChannel
>() {}

/** A channel that never emits — the default until a transport is provided. */
export const NoopReactiveChannel: ReactiveChannel = {
  subscribe: () => () => undefined,
};

export interface InMemoryReactiveChannel extends ReactiveChannel {
  /** Push an event to every current subscriber (drives tests and the mock). */
  emit(event: DomainEvent<EntityChangeEvent>): void;
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
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(event) {
      for (const listener of listeners) {
        listener(event);
      }
    },
  };
}
