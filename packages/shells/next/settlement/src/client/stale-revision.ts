import type { EntifixFailure } from '@entifix/core';

/**
 * The revision a refused save names as current, when the failure is a
 * `staleRevision` (entifix 0032) — and `undefined` for any other failure, or
 * for a refusal that names none.
 */
export const staleCurrentOf = (error?: EntifixFailure): number | undefined => {
  if (error?.code !== 'staleRevision') return undefined;
  return (error as EntifixFailure & { current?: number }).current;
};
