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
  /** Assign the code and persist — the actual write. */
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
