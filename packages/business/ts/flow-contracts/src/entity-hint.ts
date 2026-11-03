import {
  type DomainEvent,
  type EntityChangeEvent,
  EntityChangeEventSchema,
  registerEvent,
} from '@entifix/core';

/**
 * What the realtime slice pushes a browser that may not read the record a
 * domain event carries: a hint `{entity, change, id}`, on which the browser
 * re-reads through its own guarded route
 * ([ADR 0072](../../../../../docs/adr/0072-the-realtime-slice-flow-status-and-the-edge.md)).
 *
 * ⚠️ **Its own registered name, not the domain event's.** A pushed frame is
 * encoded through the registry before it leaves the server and decoded through
 * it in the browser, so a hint written under `order.placed` would fail
 * `order.placed`'s schema on the way out and be dropped as unencodable. The
 * shape is entifix's `EntityChangeEvent`, which is what the browser's cache
 * reads as a hint — the same name has to be registered on both sides, which is
 * why it lives in a `business:policy` package rather than in the realtime shell.
 *
 * Audience is required, like every pushable event: a hint names a record id,
 * and an id is enough to say that a record exists.
 */
export const ENTITY_CHANGED = 'entity.changed';

registerEvent(ENTITY_CHANGED, EntityChangeEventSchema, {
  audience: 'required',
});

/**
 * The hint for `event`: the domain event's identity, source and audience, with
 * `data` narrowed to which record changed. The aggregate and version are
 * dropped, because a hint is not a snapshot and must not be read as one.
 */
export const entityHint = (
  event: DomainEvent,
  change: EntityChangeEvent,
): DomainEvent<EntityChangeEvent> => ({
  name: ENTITY_CHANGED,
  id: event.id,
  source: event.source,
  at: event.at,
  ...(event.correlationId === undefined
    ? {}
    : { correlationId: event.correlationId }),
  ...(event.audience === undefined ? {} : { audience: event.audience }),
  data: change,
});
