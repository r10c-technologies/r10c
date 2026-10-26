/**
 * The stock-management port's contract suite and its in-memory double
 * ([ADR 0063](../../../../../docs/adr/0063-a-cell-reaches-full-coverage-through-fakes-and-contract-suites.md)).
 * Spec-only: it imports `vitest`.
 */
export * from './in-memory-stock-ledger';
export * from './stock-ledger.contract';
