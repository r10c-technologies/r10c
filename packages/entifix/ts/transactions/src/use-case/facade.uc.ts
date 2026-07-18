import { Effect } from 'effect';

import { CommandTag, LockHandlesTag, OutcomeTag } from '../mixins/transaction-mixins';
import { type LockHandle,LockServiceTag } from '../ports/lock-service';
import { TransactionHandlerTag } from '../ports/transaction-handler';

/**
 * The five-step transaction facade, each step a use-case in the same
 * `*UCFactory -> Effect.gen -> yield Context.Tag` style as the entity
 * use-cases. Inputs arrive through Context so a step is agnostic to how the
 * command/handles/outcome were produced. The {@link runTransaction} engine
 * sequences them.
 */

/** 1. Validate — delegates to the injected domain handler. */
export function validateUCFactory() {
  return Effect.gen(function* () {
    const handler = yield* TransactionHandlerTag;
    const command = yield* CommandTag;
    yield* handler.validate(command);
  });
}

/** 2. Lock — acquire every resource key the handler declares for the command. */
export function lockUCFactory() {
  return Effect.gen(function* () {
    const lockService = yield* LockServiceTag;
    const handler = yield* TransactionHandlerTag;
    const command = yield* CommandTag;

    const handles: LockHandle[] = [];
    for (const key of handler.lockKeys(command)) {
      handles.push(yield* lockService.acquire(key));
    }
    return handles as readonly LockHandle[];
  });
}

/** 3. Execute — the write; returns the assigned code + stored id. */
export function executeUCFactory() {
  return Effect.gen(function* () {
    const handler = yield* TransactionHandlerTag;
    const command = yield* CommandTag;
    return yield* handler.execute(command);
  });
}

/** 4. Rollback — undo a failed execution (idempotent). */
export function rollbackUCFactory() {
  return Effect.gen(function* () {
    const handler = yield* TransactionHandlerTag;
    const command = yield* CommandTag;
    const outcome = yield* OutcomeTag;
    yield* handler.rollback(command, outcome);
  });
}

/** 5. Free — release every held lock, best-effort per handle. */
export function freeUCFactory() {
  return Effect.gen(function* () {
    const lockService = yield* LockServiceTag;
    const handles = yield* LockHandlesTag;
    for (const handle of handles) {
      yield* lockService.release(handle);
    }
  });
}
