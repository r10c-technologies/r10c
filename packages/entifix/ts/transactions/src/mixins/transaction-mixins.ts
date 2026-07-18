import { Context } from 'effect';

import type { TransactionCommand } from '../contracts/command';
import type { LockHandle } from '../ports/lock-service';
import type { TransactionOutcome } from '../ports/transaction-handler';

/**
 * The runtime inputs the facade use-cases yield — the transaction analogue of
 * `EntityTag`/`EntityIdTag`. The engine provides them at the right moment
 * (`LockHandlesTag` after `lock`, `OutcomeTag` before `rollback`).
 */
export class CommandTag extends Context.Tag('TransactionCommandTag')<
  CommandTag,
  TransactionCommand
>() {}

export class LockHandlesTag extends Context.Tag('LockHandlesTag')<
  LockHandlesTag,
  readonly LockHandle[]
>() {}

export class OutcomeTag extends Context.Tag('TransactionOutcomeTag')<
  OutcomeTag,
  TransactionOutcome | undefined
>() {}
