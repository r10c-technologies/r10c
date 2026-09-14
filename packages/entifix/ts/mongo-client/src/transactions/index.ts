/**
 * The half of this package that needs `@entifix/transactions`: the
 * transactional outbox ADR 0028 writes inside the entity's own Mongo
 * transaction, and the inbox that makes a redelivered command idempotent.
 *
 * Behind a subpath so entity CRUD over Mongo does not arrive with the saga
 * engine attached. Package-level dependencies are not per-subpath, so what
 * actually keeps it optional is the `peerDependenciesMeta.optional` entry in
 * the manifest — importing this module without that peer installed is the
 * error, and it is the adopter's to make deliberately.
 */
export * from '../inbox/store';
export * from '../outbox/metrics';
export * from '../outbox/relay';
export * from '../outbox/store';
