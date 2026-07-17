import type { SerializedEntity } from '../entity-definition/serializer';
import type { Entity } from '../types/Entity';
import type { EntityLoadRequest } from '../types/EntityLoadRequest';

/**
 * Discriminates what {@link EntifixEnvelope.data} carries.
 */
export type EntifixEnvelopeType = 'entity' | 'entityCollection' | 'entityPage';

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

export interface EntifixEnvelopeMeta {
  type: EntifixEnvelopeType;
  /** The target entity's `key` (falling back to its class name). */
  entity: string;
  links?: EntifixEnvelopeLink[];
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
