/**
 * The settlement-management ports' contract suite and its in-memory double
 * ([ADR 0063](../../../../../docs/adr/0063-a-cell-reaches-full-coverage-through-fakes-and-contract-suites.md)).
 * Spec-only: it imports `vitest`.
 */
export * from './in-memory-settlement-store';
export * from './settlement-store.contract';
