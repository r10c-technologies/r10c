import type {
  DomainEvent,
  EntityChangeEvent,
} from '@r10c/entifix-ts-core';
import { Context, Effect, PubSub, Stream } from 'effect';

import type { TransactionEvent, TransactionState } from '../contracts/event';

/**
 * How many undelivered events one hub holds before the oldest are dropped.
 *
 * Bounded with a **sliding** strategy rather than unbounded: a browser that
 * stops reading its connection must not be able to grow the service's heap, and
 * a reactive hint is worth less the older it is — the record behind it is the
 * truth, and re-reading it is cheap (ADR 0036 declines replay for the same
 * reason).
 */
const CAPACITY = 256;

/**
 * What a transaction's state means for the entity it is about.
 *
 * `type: 'create'` is the only command that exists, so `PENDING` and
 * `COMPLETED` both announce an entity coming into existence — the id is already
 * known at `accepted`, because ADR 0028 makes the client-minted transaction id
 * the stored entity's id. A terminal failure announces the opposite: nothing was
 * written, so a consumer holding an optimistic row must drop it.
 *
 * When `update`/`delete` commands land this keys off `command.type` instead;
 * the state alone cannot distinguish them.
 */
const changeFor = (state: TransactionState): EntityChangeEvent['change'] =>
  state === 'PENDING' || state === 'COMPLETED' ? 'created' : 'deleted';

/**
 * Rewrites a transaction event as the entity change it announces, keeping the
 * message's own metadata untouched.
 *
 * No fourth framing and no duplicated fields: the transaction id, the timestamp
 * and the sequence a consumer needs are already `meta.event.correlationId`,
 * `.at` and `.id` on the message this returns (ADR 0036).
 */
export const entityChangeFor = (
  event: DomainEvent<TransactionEvent>,
): DomainEvent<EntityChangeEvent> => ({
  name: event.name,
  id: event.id,
  source: event.source,
  at: event.at,
  correlationId: event.correlationId,
  data: {
    entity: event.data.entity,
    change: changeFor(event.data.state),
    id: event.data.entityId ?? event.data.transactionId,
  },
});

/**
 * The in-process fan-out behind `GET /api/transaction/events`.
 *
 * One subscription to the bus feeds it; each connected browser takes its own
 * filtered view. It is a hub rather than a bus subscription per connection
 * because a queue per open tab is a broker resource a client controls.
 */
export interface TransactionStreamHub {
  /** Offer one bus event to every connection scoped to its organization. */
  publish(event: DomainEvent<TransactionEvent>): Effect.Effect<void>;
  /**
   * One connection's view, already scoped and already mapped.
   *
   * ⚠️ **Fails closed.** An event whose `organizationId` does not match is
   * dropped, and so is one carrying none at all — including every event emitted
   * before that member existed. Defaulting an absent organization to "everyone"
   * is a cross-tenant delivery that raises nothing.
   */
  subscribe(
    organizationId: string,
  ): Stream.Stream<DomainEvent<EntityChangeEvent>>;
}

export class TransactionStreamHubTag extends Context.Tag(
  'TransactionStreamHubTag',
)<TransactionStreamHubTag, TransactionStreamHub>() {}

/** Builds a hub over a sliding {@link PubSub}. */
export const makeTransactionStreamHub = (
  pubsub: PubSub.PubSub<DomainEvent<TransactionEvent>>,
): TransactionStreamHub => ({
  publish: event => Effect.asVoid(PubSub.publish(pubsub, event)),
  subscribe: organizationId =>
    Stream.fromPubSub(pubsub).pipe(
      Stream.filter(event => event.data.organizationId === organizationId),
      Stream.map(entityChangeFor),
    ),
});

/** Opens a hub. Scoped, so its subscribers are released with the scope. */
export const makeTransactionStreamHubEffect = Effect.map(
  PubSub.sliding<DomainEvent<TransactionEvent>>(CAPACITY),
  makeTransactionStreamHub,
);
