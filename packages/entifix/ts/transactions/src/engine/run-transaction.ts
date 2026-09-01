import { Effect } from 'effect';

import { acceptedEvent, failedEvent } from '../contracts/event';
import { TransactionOutboxTag } from '../contracts/outbox';
import {
  CommandTag,
  LockHandlesTag,
  OutcomeTag,
} from '../mixins/transaction-mixins';
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
 * - {@link acceptTransaction} — validate -> claim -> lock. Runs before the
 *   service answers `202`; its failures are the client's answer.
 * - {@link completeTransaction} — execute -> free, or rollback -> record
 *   `failed` -> free. Forked after `202`; `free` always runs via `ensuring`, so
 *   locks never leak on a rollback path.
 *
 * **The engine never publishes.** Every event it produces goes to the
 * {@link TransactionOutbox}, and a relay carries the outbox to the broker. That
 * is the whole fix for the dual write: an event that only ever existed in a
 * `bus.publish` call between two Mongo writes is lost when the broker is down,
 * and the transaction is then mislabelled `STALE` despite having succeeded.
 */

/**
 * Accept phase (synchronous).
 *
 * The order is deliberate: validate, then **claim, then lock**. The claim is the
 * outbox insert for the `accepted` event, and its uniqueness on
 * `transactionId + step` is what makes the client-generated id an idempotency
 * key — a replayed command is recognised here, before a lock is taken and
 * before any work is forked. Locking first would make a retry queue behind its
 * own original.
 */
export function acceptTransaction() {
  return Effect.gen(function* () {
    const command = yield* CommandTag;
    const outbox = yield* TransactionOutboxTag;

    yield* validateUCFactory();

    const claim = yield* outbox.enqueue(acceptedEvent(command));
    if (claim === 'duplicate') {
      return { status: 'duplicate' } as const;
    }

    const handles = yield* lockUCFactory();
    return { status: 'accepted', handles } as const;
  });
}

/** What {@link acceptTransaction} decided — a fresh command, or a replay. */
export type AcceptOutcome = Effect.Effect.Success<
  ReturnType<typeof acceptTransaction>
>;

/**
 * Execute phase (asynchronous continuation). Never leaks locks.
 *
 * The success arm records **nothing**: `execute` is contractually required to
 * have written the `completed` entry in the same storage transaction as its
 * state change, because only the handler holds the session that can make those
 * two writes one. Recording it here as well would reintroduce the dual write in
 * the opposite direction — an event announcing a write that may have rolled
 * back.
 *
 * The failure arm does record, because there is no state change left to be
 * atomic with: the rollback has already undone it.
 */
export function completeTransaction(handles: readonly LockHandle[]) {
  return Effect.gen(function* () {
    const command = yield* CommandTag;
    const outbox = yield* TransactionOutboxTag;

    const free = freeUCFactory().pipe(
      Effect.provideService(LockHandlesTag, handles),
      Effect.ignore,
    );

    yield* executeUCFactory().pipe(
      Effect.matchEffect({
        onSuccess: () => Effect.void,
        onFailure: error =>
          rollbackUCFactory().pipe(
            Effect.provideService(OutcomeTag, undefined),
            Effect.ignore,
            Effect.andThen(
              // Best-effort: the transaction already failed, and a store that
              // cannot take the failure record must not turn into an unhandled
              // defect in a forked daemon. The recovery sweep is what notices.
              Effect.ignore(outbox.enqueue(failedEvent(command, error))),
            ),
          ),
      }),
      Effect.ensuring(free),
    );
  });
}
