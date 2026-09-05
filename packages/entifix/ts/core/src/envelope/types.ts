import type { EntityMetadataDocument } from '../entity-definition/metadata';
import type { SerializedEntity } from '../entity-definition/serializer';
import type { Entity, EntityId } from '../types/Entity';
import type { EntityLoadRequest } from '../types/EntityLoadRequest';

/**
 * Discriminates what {@link EntifixEnvelope.data} carries.
 *
 * `command`/`transactionEvent` extend the contract for the transactions layer:
 * a write is issued as a `command` and the saga reports progress as
 * `transactionEvent`s. Their `data` shapes live in `@r10c/entifix-transactions`
 * — core only owns the discriminant so every artifact agrees on it.
 *
 * `event` is what actually rides the bus, and it is deliberately not
 * `transactionEvent`: once a message can be `catalog.published` as easily as
 * `transaction.completed`, naming the envelope after one publisher's flow is
 * wrong. `transactionEvent` survives for the HTTP surface that frames a
 * transaction *record* — the `202` body and the tracker's read routes — which
 * is a separate wart, not a synonym for this one.
 *
 * `entityMetadata` is the same extension made once more, for the action model:
 * its `data` is an {@link EntityMetadataDocument}, which core does own because
 * both the service that computes it and the controls that render it are already
 * below the layer that would otherwise host it.
 */
export type EntifixEnvelopeType =
  | 'entity'
  | 'entityCollection'
  | 'entityPage'
  | 'command'
  | 'event'
  | 'transactionEvent'
  | 'entityMetadata';

export type EntifixEnvelopeMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/**
 * A HATEOAS affordance: where the peer can go next from this message. Optional —
 * the envelope stands on its own without links, and only the artifact that owns
 * a route surface (today the REST service) is able to fill them in.
 */
export interface EntifixEnvelopeLink {
  rel: string;
  href: string;
  method?: EntifixEnvelopeMethod;
}

/**
 * The facts a message carries about *itself*, as opposed to about what
 * happened. Present only when the envelope is a bus message.
 *
 * The split rule: `meta` describes the message, `data` describes the
 * occurrence. So `correlationId` belongs here and an outcome's `code` does not.
 *
 * **`source` is never a consumer branch.** It is there for routing,
 * observability and audit. A handler that behaves differently depending on who
 * published re-couples the two services the bus decoupled — which is why .NET's
 * canonical `(sender, eventArgs)` types its sender as bare `object`, making the
 * dependency awkward on purpose. TypeScript cannot reproduce that friction, so
 * here it is a rule rather than a type.
 */
export interface EntifixEventMeta {
  /**
   * What happened, in the register's vocabulary: `catalog.published`,
   * `transaction.completed`. Declared in `tools/slices/*.slice.ts` as
   * `publishedEvents`/`subscriptions`, and used verbatim as the AMQP routing
   * key — which is what makes a subscriber's declared interest and its actual
   * queue binding the same string.
   */
  name: string;
  /**
   * Unique per message, and **the** deduplication key. Delivery is
   * at-least-once, so a consumer that must not fold twice keys on this.
   *
   * Not `correlationId`: one flow emits several messages, so correlating and
   * deduplicating are different questions. Keying dedup on the correlation id
   * makes a transaction's `completed` look like a duplicate of its `accepted`.
   */
  id: string;
  /** The emitting **slice** (ADR 0020's ownership noun), e.g. `marketplace-admin`. */
  source: string;
  /** ISO-8601 emission time. */
  at: string;
  /** Ties every message of one flow together — a transaction id, a saga id. */
  correlationId?: string;
}

export interface EntifixEnvelopeMeta {
  type: EntifixEnvelopeType;
  /**
   * The target entity's `key` (falling back to its class name).
   *
   * Optional, because a bus message need not be about an entity at all —
   * `settlement.run.completed` is about a run. What a message *is* lives in
   * {@link EntifixEventMeta.name}; this stays the entity label the HTTP arm
   * routes on.
   */
  entity?: string;
  links?: EntifixEnvelopeLink[];
  /** Present only on a bus message. */
  event?: EntifixEventMeta;
}

/**
 * One message on the bus: its own metadata, plus the payload describing what
 * happened.
 *
 * Generic in the payload so a publisher keeps its own shape —
 * `DomainEvent<TransactionEvent>` today, `DomainEvent<PublishedOffering>` when
 * ADR 0009's projection event lands — without the transport learning either.
 */
export interface DomainEvent<TData = unknown> extends EntifixEventMeta {
  data: TData;
}

/**
 * A change to an entity that happened on the server, delivered out-of-band —
 * the `data` of a bus/stream `event` envelope rather than a framing of its own
 * (ADR 0036). `entity` is the `key ?? name` an adapter routes on, the same
 * string `entityQueryScope` uses, so a subscriber can invalidate exactly the
 * affected query keys.
 *
 * It lives in core rather than beside the React `ReactiveChannel` that consumes
 * it because both ends need it: the service maps a `TransactionEvent` onto it,
 * and `entifix:react` sits above every layer that does the mapping.
 *
 * Deliberately **no** `transactionId`, timestamp or sequence: all three already
 * exist one level up as `meta.event.correlationId`, `.at` and `.id`, and
 * duplicating them onto the payload is how two sources of the same fact drift.
 */
export interface EntityChangeEvent {
  entity: string;
  change: 'created' | 'updated' | 'deleted';
  id: EntityId;
}

/**
 * The standard message exchanged between entifix artifacts.
 *
 * Every request and response body is an envelope: `meta` describes the payload,
 * `data` is the payload. It is deliberately transport-free — it lives in `core`
 * and knows nothing about HTTP — so the same contract can carry entities over
 * REST today and amqp or websockets later.
 */
export interface EntifixEnvelope<TData = unknown> {
  meta: EntifixEnvelopeMeta;
  data: TData;
}

/**
 * `data` shape when `meta.type` is `entityPage`. Generic in the entity so the
 * echoed `request` keeps its `keyof TEntity` filter/sort types — `EntityLoadRequest`
 * is invariant in its entity, so a non-generic `EntityLoadRequest<Entity>` here
 * would not accept a caller's `EntityLoadRequest<Product>`.
 */
export interface SerializedEntityPage<TEntity extends Entity = Entity> {
  items: SerializedEntity[];
  total: number;
  request?: EntityLoadRequest<TEntity>;
}

export type EntityEnvelope = EntifixEnvelope<SerializedEntity>;
export type EntityCollectionEnvelope = EntifixEnvelope<SerializedEntity[]>;
export type EntityPageEnvelope<TEntity extends Entity = Entity> =
  EntifixEnvelope<SerializedEntityPage<TEntity>>;
export type EntityMetadataEnvelope = EntifixEnvelope<EntityMetadataDocument>;

/**
 * A bus message on the wire. `meta.event` is always populated, and
 * `readEventEnvelope` is what proves it before a consumer sees the payload.
 */
export type EventEnvelope<TData = unknown> = EntifixEnvelope<TData> & {
  meta: EntifixEnvelopeMeta & { event: EntifixEventMeta };
};
