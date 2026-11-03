// Loaded for their registrations. Every pushed event is decoded off the bus and
// encoded onto the stream through the message registry, so the schema of each
// projected event has to be registered in this process — and nothing else here
// would import the contracts that own them.
import '@r10c/business-ts-catalog-contracts';
import '@r10c/business-ts-order-contracts';

import type { DomainEvent, EntityChangeEvent } from '@entifix/core';
import { entityHint } from '@r10c/business-ts-flow-contracts';

/**
 * An entity a browser can be pushed about, named the way its permission is:
 * `<domain>:<key>:read` decides whether a member receives the record itself or
 * only a hint ([ADR 0072](../../../../../docs/adr/0072-the-realtime-slice-flow-status-and-the-edge.md)).
 */
export interface PushEntity {
  readonly domain: string;
  readonly key: string;
}

export const PRODUCT_ORDER: PushEntity = {
  domain: 'order-management',
  key: 'product-order',
};

export const PRODUCT_OFFERING: PushEntity = {
  domain: 'product-configuration-management',
  key: 'product-offering',
};

/** Every entity some projection pushes, for the stream's read-permission check. */
export const PUSH_ENTITIES: readonly PushEntity[] = [
  PRODUCT_ORDER,
  PRODUCT_OFFERING,
];

/**
 * Who among an event's audience may receive one pushed variant of it.
 *
 * - `all` — every admitted connection (a hint nobody needs a grant for, a flow
 *   outcome).
 * - `readers` — only a connection whose member's role grants the entity's read
 *   permission: the variant carries the record itself.
 * - `nonReaders` — the complement, so a member receives exactly one of the two.
 */
export type PushGate =
  | { readonly to: 'all' }
  | { readonly to: 'readers' | 'nonReaders'; readonly entity: string };

/** One variant of a domain event, as the stream delivers it. */
export interface Pushed {
  readonly event: DomainEvent;
  readonly topics: readonly string[];
  readonly gate: PushGate;
}

/**
 * What a browser receives for one subscribed event. Domain packages never know
 * a browser exists, so this is where that decision is made — one projection
 * per subscription, which `@r10c/slices` checks.
 */
export type PushProjection = (event: DomainEvent) => readonly Pushed[];

const entityTopic = (key: string) => `entity:${key}`;
const recordTopic = (key: string, id: string) => `record:${key}:${id}`;
const flowTopic = (flowId: string) => `flow:${flowId}`;

/**
 * A record change. With `snapshot`, the event's own `data` **is** the record's
 * read-model shape, so a reader receives the event as it is and everyone else
 * a hint; without it the event carries something else (a publication, a
 * projection input) and everyone receives the hint.
 *
 * An event that names no aggregate says nothing a cache can key on, and is
 * pushed to nobody.
 */
const recordChange =
  (
    entity: PushEntity,
    change: EntityChangeEvent['change'],
    { snapshot }: { readonly snapshot: boolean },
  ): PushProjection =>
  event => {
    if (event.aggregate === undefined) return [];
    const { id } = event.aggregate;
    const topics = [entityTopic(entity.key), recordTopic(entity.key, id)];
    const hint = entityHint(event, { entity: entity.key, change, id });
    if (!snapshot) return [{ event: hint, topics, gate: { to: 'all' } }];
    return [
      { event, topics, gate: { to: 'readers', entity: entity.key } },
      { event: hint, topics, gate: { to: 'nonReaders', entity: entity.key } },
    ];
  };

/**
 * A flow's outcome, to the flow's own audience: the organizations and parties
 * the slip named, and any capability holder by digest. Pushed as it is — the
 * browser's pending-flow settlement reads `flow.completed` and `flow.failed`
 * by name.
 */
const flowOutcome: PushProjection = event =>
  event.aggregate === undefined
    ? []
    : [
        {
          event,
          topics: [flowTopic(event.aggregate.id)],
          gate: { to: 'all' },
        },
      ];

/**
 * The push projections, one per broadcast subscription.
 *
 * `order.*` carries the serialized order, which is the `ProductOrder`
 * read-model shape, so a member who may read orders receives the record.
 * `catalog.*` carries a publication snapshot rather than a `ProductOffering`,
 * so everyone receives a hint and re-reads.
 *
 * ⚠️ **`payment.*` is absent on purpose.** A payment is registered with no
 * audience and carries no vendor, so under a filter that fails closed it would
 * reach nobody; it is pushed once a capture is allocated per order (#480).
 */
export const PUSH_PROJECTIONS: Readonly<Record<string, PushProjection>> = {
  'order.placed': recordChange(PRODUCT_ORDER, 'created', { snapshot: true }),
  'order.cancelled': recordChange(PRODUCT_ORDER, 'updated', { snapshot: true }),
  'catalog.published': recordChange(PRODUCT_OFFERING, 'updated', {
    snapshot: false,
  }),
  'catalog.unpublished': recordChange(PRODUCT_OFFERING, 'updated', {
    snapshot: false,
  }),
  'flow.completed': flowOutcome,
  'flow.failed': flowOutcome,
};
