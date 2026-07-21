import type {
  EventBus,
  LockHandle,
  LockService,
  SequenceService,
  TransactionEvent,
} from '@r10c/entifix-transactions';
import {
  EntifixConnError,
  type EntifixError,
  EntifixLockError,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';

export interface InMemoryLockService extends LockService {
  /** Keys currently held, in acquisition order. */
  readonly held: string[];
  /** Every acquire/release in the order it happened. */
  readonly log: ReadonlyArray<{ action: 'acquire' | 'release'; key: string }>;
  /**
   * Marks `key` as already taken by someone else, so the next `acquire` fails
   * with {@link EntifixLockError} — the 409 path of the transaction facade.
   */
  contendOn(key: string): void;
}

/**
 * In-memory {@link LockService}. Acquisition is immediate and uncontended
 * unless {@link InMemoryLockService.contendOn} says otherwise, and `release`
 * only frees a lock whose token matches — the compare-and-delete rule the Redis
 * adapter enforces with a Lua script.
 */
export const makeInMemoryLockService = (): InMemoryLockService => {
  const tokens = new Map<string, string>();
  const contended = new Set<string>();
  const log: Array<{ action: 'acquire' | 'release'; key: string }> = [];
  let counter = 0;

  return {
    acquire: (key) =>
      Effect.suspend(() => {
        if (contended.has(key) || tokens.has(key)) {
          return Effect.fail(
            new EntifixLockError(`Could not acquire lock "${key}"`, undefined, {
              key,
            }),
          );
        }
        const token = `token-${(counter += 1)}`;
        tokens.set(key, token);
        log.push({ action: 'acquire', key });
        return Effect.succeed({ key, token });
      }),
    release: (handle: LockHandle) =>
      Effect.sync(() => {
        if (tokens.get(handle.key) === handle.token) {
          tokens.delete(handle.key);
          log.push({ action: 'release', key: handle.key });
        }
      }),
    get held() {
      return [...tokens.keys()];
    },
    get log() {
      return log;
    },
    contendOn: (key) => {
      contended.add(key);
    },
  };
};

export interface InMemorySequenceService extends SequenceService {
  /** The current value of every sequence drawn from so far. */
  readonly values: Readonly<Record<string, number>>;
}

/**
 * In-memory {@link SequenceService} — a plain counter per name. Atomicity is
 * what the Redis `INCR` adapter buys; single-threaded JS gives it for free here.
 */
export const makeInMemorySequenceService = (): InMemorySequenceService => {
  const sequences = new Map<string, number>();

  return {
    next: (name) =>
      Effect.sync(() => {
        const next = (sequences.get(name) ?? 0) + 1;
        sequences.set(name, next);
        return next;
      }),
    get values() {
      return Object.fromEntries(sequences);
    },
  };
};

export interface RecordingEventBus extends EventBus {
  /** Every event published, in order. */
  readonly published: TransactionEvent[];
  /** Pushes an event to all subscribers, as a delivery from the broker would. */
  deliver(event: TransactionEvent): Effect.Effect<void, EntifixError>;
  /** Makes the next `publish` fail, for the broker-unavailable branch. */
  failNextPublish(): void;
}

/**
 * In-memory {@link EventBus} that records what was published rather than
 * asserting on it. Prefer reading `bus.published` in a test over a mock's call
 * assertions: the expectation then reads as state, not as a spy protocol.
 */
export const makeRecordingEventBus = (): RecordingEventBus => {
  const published: TransactionEvent[] = [];
  const handlers: Array<
    (event: TransactionEvent) => Effect.Effect<void, EntifixError>
  > = [];
  let failNext = false;

  return {
    publish: (event) =>
      Effect.suspend(() => {
        if (failNext) {
          failNext = false;
          return Effect.fail(
            new EntifixConnError('Event bus unavailable', undefined, {
              transactionId: event.transactionId,
            }),
          );
        }
        published.push(event);
        return Effect.void;
      }),
    subscribe: (handler) =>
      Effect.sync(() => {
        handlers.push(handler);
      }),
    deliver: (event) =>
      Effect.forEach(handlers, (handler) => handler(event), {
        discard: true,
      }),
    get published() {
      return published;
    },
    failNextPublish: () => {
      failNext = true;
    },
  };
};
