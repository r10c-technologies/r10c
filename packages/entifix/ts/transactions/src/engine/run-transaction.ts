import { Effect } from 'effect';

import {
  acceptedEvent,
  completedEvent,
  failedEvent,
} from '../contracts/event';
import { CommandTag, LockHandlesTag, OutcomeTag } from '../mixins/transaction-mixins';
import { EventBusTag } from '../ports/event-bus';
import type { LockHandle } from '../ports/lock-service';
import {
  executeUCFactory,
  freeUCFactory,
  lockUCFactory,
  rollbackUCFactory,
  validateUCFactory,
} from '../use-case/facade.uc';

/**
 * The saga engine, split at the 202 boundary so validation/lock failures are
 * synchronous (mapped to `400`/`409`) while the write runs asynchronously:
 *
 * - {@link acceptTransaction} — validate -> lock -> publish `accepted`. Runs
 *   before the service answers `202`; its failures are the client's answer.
 * - {@link completeTransaction} — execute -> free (+ publish `completed`), or
 *   rollback -> free (+ publish `failed`). Forked after `202`; `free` always
 *   runs via `ensuring`, so locks never leak on a rollback path.
 *
 * No step runs twice — the doc's redundant "validate+lock, then validate+lock+
 * execute" is collapsed into one accept phase and one execute phase.
 */

/** Accept phase (synchronous). Returns the held locks for the execute phase. */
export function acceptTransaction() {
  return Effect.gen(function* () {
    const command = yield* CommandTag;
    const bus = yield* EventBusTag;

    yield* validateUCFactory();
    const handles = yield* lockUCFactory();
    yield* bus.publish(acceptedEvent(command));

    return handles;
  });
}

/** Execute phase (asynchronous continuation). Never leaks locks. */
export function completeTransaction(handles: readonly LockHandle[]) {
  return Effect.gen(function* () {
    const command = yield* CommandTag;
    const bus = yield* EventBusTag;

    const free = freeUCFactory().pipe(
      Effect.provideService(LockHandlesTag, handles),
      Effect.ignore,
    );

    yield* executeUCFactory().pipe(
      Effect.matchEffect({
        onSuccess: (outcome) => bus.publish(completedEvent(command, outcome)),
        onFailure: (error) =>
          rollbackUCFactory().pipe(
            Effect.provideService(OutcomeTag, undefined),
            Effect.ignore,
            Effect.andThen(bus.publish(failedEvent(command, error))),
          ),
      }),
      Effect.ensuring(free),
    );
  });
}
