/**
 * The authn ports' contract suites and their in-memory doubles
 * ([ADR 0063](../../../../../docs/adr/0063-a-cell-reaches-full-coverage-through-fakes-and-contract-suites.md)).
 * Spec-only: it imports `vitest`.
 */
export * from './account-repository.contract';
export * from './in-memory-accounts';
export * from './in-memory-session-scope-resolver';
export * from './in-memory-session-stores';
export * from './notification-port.contract';
export * from './session-scope-resolver.contract';
export * from './session-stores.contract';
export * from './user-device-repository.contract';
