/**
 * The marketplace-vendor port's contract suite and its in-memory double
 * ([ADR 0063](../../../../../docs/adr/0063-a-cell-reaches-full-coverage-through-fakes-and-contract-suites.md)).
 * Spec-only: it imports `vitest`.
 */
export * from './in-memory-published-vendors';
export * from './published-vendors.contract';
