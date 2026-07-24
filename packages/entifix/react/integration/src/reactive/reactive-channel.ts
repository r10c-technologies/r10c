import { type EntityId } from '@r10c/entifix-ts-core';
import { Context } from 'effect';

/**
 * A change to an entity that happened on the server, delivered out-of-band
 * (today from an in-memory mock, tomorrow from a WebSocket). The `entity` is the
 * `key ?? name` an adapter routes on — the same string {@link entityQueryScope}
 * uses — so a subscriber can invalidate exactly the affected query keys.
 */
export interface EntityChangeEvent {
  entity: string;
  change: 'created' | 'updated' | 'deleted';
  id: EntityId;
}

export type EntityChangeListener = (event: EntityChangeEvent) => void;

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
  emit(event: EntityChangeEvent): void;
}

/**
 * A synchronous in-memory channel: `emit` fans out to every live subscriber.
 * Backs specs and stands in for the real socket while the transport is deferred.
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
