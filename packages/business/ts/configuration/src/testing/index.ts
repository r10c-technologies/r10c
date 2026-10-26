/**
 * The configuration ports' contract suites and their in-memory doubles
 * ([ADR 0063](../../../../../docs/adr/0063-a-cell-reaches-full-coverage-through-fakes-and-contract-suites.md)).
 * Spec-only: it imports `vitest`.
 */
export * from './configuration-lookup.contract';
export * from './configuration-writer.contract';
export * from './in-memory-configuration-lookup';
export * from './in-memory-configuration-writer';
