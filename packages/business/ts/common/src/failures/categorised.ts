import { type EntifixFailure, isFailure } from '@entifix/core';
import { Effect } from 'effect';

/**
 * An effect read through `EntityRepository`, failing only with what it
 * categorised.
 *
 * The port still admits entifix's uncategorised error class beside its typed
 * failures, and no adapter this fleet composes raises it — the Mongo, REST and
 * static repositories all fail typed. One reaching here is a bug, and a
 * failure nobody categorised is a defect (entifix ADR 0013): it answers the
 * opaque `500` with its trace rather than being guessed into a category that
 * would tell the caller something false. entifix #126 deletes the class, and
 * with it the arm this removes.
 */
export const categorised = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, Extract<E, EntifixFailure>, R> =>
  effect.pipe(
    Effect.catch(error =>
      isFailure(error)
        ? Effect.fail(error as Extract<E, EntifixFailure>)
        : Effect.die(error),
    ),
  );
