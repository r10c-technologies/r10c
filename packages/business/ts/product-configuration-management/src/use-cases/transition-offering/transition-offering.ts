import { EntityRepositoryTag } from '@r10c/entifix-ts-business';
import type { EntityId } from '@r10c/entifix-ts-core';
import { Context, Data, Effect } from 'effect';

import type { ProductOffering } from '../../entities/product-offering';
import {
  offeringStatusAfter,
  type OfferingTransition,
} from '../../values/offering-transition';

/** Which offering to move, and which way. */
export interface TransitionOfferingInput {
  readonly id: EntityId;
  readonly transition: OfferingTransition;
}

export class TransitionOfferingInputTag extends Context.Tag(
  'TransitionOfferingInputTag',
)<TransitionOfferingInputTag, TransitionOfferingInput>() {}

/**
 * The code a route renders when the move is not allowed.
 *
 * A **code, not a sentence**: the browser resolves it through the shared
 * `errors` catalog and `@r10c/i18n-check` fails the build on one the catalog
 * lacks. Neither types nor locale parity can see a missing code — the render
 * path casts the typed-key gate away, and a code absent from both locales is
 * symmetric — so that check is the only thing looking.
 */
export const ILLEGAL_OFFERING_TRANSITION = 'illegalOfferingTransition';

/** An offering that cannot make the move that was asked of it. */
export class IllegalOfferingTransition extends Data.TaggedError(
  'IllegalOfferingTransition',
)<{
  readonly id: EntityId;
  readonly from: string;
  readonly transition: OfferingTransition;
}> {
  readonly code = ILLEGAL_OFFERING_TRANSITION;
}

/**
 * Move one offering along its lifecycle.
 *
 * The rule lives in `offeringStatusAfter` and the enforcement lives **here**,
 * in the domain — not in the route that calls it. That is the whole reason this
 * exists rather than a status field the generated form could set: a status enum
 * a user can write to anything is not a lifecycle, it is a text box with four
 * suggestions.
 *
 * Framework-free, like every use case in this repository: the repository
 * arrives as a tag and the caller has already been authorized by the route. It
 * reads and writes a single record in a single store, so it needs no
 * transaction and no saga.
 *
 * ⚠️ **This does not announce anything yet.** Reaching `published` is what
 * `catalog.published` will be hung on, and that event must be written to the
 * outbox inside the same Mongo transaction as the status write
 * ([ADR 0028](../../../../../../docs/adr/0028-the-transaction-id-is-the-clients-and-its-event-ships-with-the-write.md)) —
 * which a framework-free port cannot do, because a driver session may not enter
 * one. So the emitting path is designed where the event's payload shape is
 * decided, and this use case is deliberately the half that only moves the
 * state.
 *
 * Also deliberately absent: refusing to publish an offering that has no
 * `ProductOfferingPrice`. It is a real precondition — the projection needs an
 * amount and a currency — but it needs a second repository, and the honest
 * place to add it is the commit that makes the projection depend on it.
 */
export const transitionOffering = Effect.gen(function* () {
  const { id, transition } = yield* TransitionOfferingInputTag;
  const repository = yield* EntityRepositoryTag;

  const offering = yield* repository.get<ProductOffering>(id);
  const next = offeringStatusAfter(offering.status, transition);

  if (next === undefined) {
    return yield* new IllegalOfferingTransition({
      id,
      from: offering.status,
      transition,
    });
  }

  offering.status = next;
  yield* repository.save(offering);

  return offering;
});
