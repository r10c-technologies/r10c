/**
 * Where a settlement run is in its life.
 *
 * `open` → `calculated` → `paid`, with `cancelled` reachable before payment.
 * The split between `open` and `calculated` is what makes a run **re-runnable**
 * before money moves: calculation is derived from the commission ledger and can
 * be thrown away, while a paid run cannot.
 */
export const SettlementRunStatuses = [
  'open',
  'calculated',
  'paid',
  'cancelled',
] as const;

export type SettlementRunStatus = (typeof SettlementRunStatuses)[number];

/** Narrow an unknown value to a settlement run status. */
export const isSettlementRunStatus = (
  value: unknown,
): value is SettlementRunStatus =>
  typeof value === 'string' &&
  (SettlementRunStatuses as readonly string[]).includes(value);
