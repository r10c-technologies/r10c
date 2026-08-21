/**
 * What a caller wants to do with a resource: the CRUD triple every entity has
 * by construction, as opposed to a verb a domain declares with `@useCase()`.
 *
 * It lives in `core` rather than in the authorization vocabulary because two
 * layers that may not import each other both need it. `business-ts-authz` owns
 * the *permission* built from an action and re-exports these as `Actions` /
 * `Action`; `entifix-react-controls` reads the same triple off a served
 * `EntityMetadataDocument` to decide whether to render Save and Delete, and
 * `entifix:react` may not depend on the business layer
 * ([ADR 0026](../../../../../../docs/adr/0026-the-use-case-descriptor-and-served-entity-metadata.md)).
 */
export const ENTITY_ACTIONS = ['read', 'write', 'delete'] as const;
export type EntityAction = (typeof ENTITY_ACTIONS)[number];
