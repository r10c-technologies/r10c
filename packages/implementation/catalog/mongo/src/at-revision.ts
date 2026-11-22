/**
 * Matches a record still at the revision a decision read it at (ADR 0079 §4).
 * A seeded record has none until its first move, and that absence is what its
 * decision read — so it must still be absent, never "any revision".
 */
export const atRevision = (revision: number | undefined) => ({
  revision: revision ?? { $exists: false },
});
