/**
 * The half of this package that needs `@entifix/transactions`: the `LockService`
 * and `SequenceService` implementations.
 *
 * Behind a subpath so a session store or a one-time-token store — neither of
 * which knows anything about a saga — can be taken on its own. What keeps it
 * optional is the `peerDependenciesMeta.optional` entry in the manifest.
 */
export * from '../adapters/redis-lock-service';
export * from '../adapters/redis-sequence-service';
