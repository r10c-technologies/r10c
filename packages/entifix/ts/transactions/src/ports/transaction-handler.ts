import type { EntifixError, EntityId } from '@r10c/entifix-ts-core';
import { Context, type Effect } from 'effect';

import type { TransactionCommand } from '../contracts/command';

/** What a successful `execute` produced — echoed into the completed event. */
export interface TransactionOutcome {
  code: string;
  entityId: EntityId;
}

/**
 * The domain-specific half of the facade. `validate`/`lock`/`execute`/`free`/
 * `rollback` are standardised by the engine, but *what* a command validates to,
 * *which* resources it locks, and *how* it executes/rolls back are the service's
 * concern — injected as this handler.
 *
 * Methods return `R = never`: the service closes over its own dependencies (db,
 * sequence, repository) when constructing the handler, exactly as
 * `makeMongoRepository` closes over its `Db`.
 */
export interface TransactionHandler {
  /** Reject a malformed/illegal command (surfaced as `400`). */
  validate(command: TransactionCommand): Effect.Effect<void, EntifixError>;
  /** The resource keys to lock for this command (e.g. the code sequence). */
  lockKeys(command: TransactionCommand): readonly string[];
  /**
   * Assign the code and persist — the actual write.
   *
   * **The implementation must write the `completed` outbox entry in the same
   * storage transaction as its state change**, as a full `OutboxEntry` whose
   * `event` is the `DomainEvent` `completedEvent` builds and whose `eventId` is
   * that event's `id`. The engine deliberately records
   * nothing on the success path, because only an implementation holds the
   * driver session that can make those two writes one fact; an engine-level
   * record would be a second dual write, announcing a state change that may
   * still roll back.
   *
   * Two rules that only a replica set will teach you, and only in production:
   * drive the transaction with the driver's retrying helper (Mongo's
   * `session.withTransaction`), because an election aborts in-flight
   * transactions with a `TransientTransactionError` the *application* is
   * expected to retry; and keep any non-transactional side effect — drawing a
   * code from the Redis sequence, say — **outside** that retried callback, or a
   * retry consumes a second value and skips a code.
   */
  execute(
    command: TransactionCommand,
  ): Effect.Effect<TransactionOutcome, EntifixError>;
  /**
   * Undo a failed execution. Runs whether or not `execute` produced an
   * `outcome`, so it must be idempotent (e.g. delete-if-exists).
   */
  rollback(
    command: TransactionCommand,
    outcome: TransactionOutcome | undefined,
  ): Effect.Effect<void, EntifixError>;
}

export class TransactionHandlerTag extends Context.Tag('TransactionHandlerTag')<
  TransactionHandlerTag,
  TransactionHandler
>() {}
