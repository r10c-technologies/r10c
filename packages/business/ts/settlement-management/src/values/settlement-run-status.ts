import type { EnumTone } from '@entifix/core';

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

/**
 * A status read at a glance: a calculated run is information until it is
 * paid, and a cancelled one reads as undone. A value with no tone reads neutral.
 */
export const SettlementRunStatusTones = {
  calculated: 'info',
  paid: 'success',
  cancelled: 'danger',
} as const satisfies Readonly<Partial<Record<SettlementRunStatus, EnumTone>>>;

/** Narrow an unknown value to a settlement run status. */
export const isSettlementRunStatus = (
  value: unknown,
): value is SettlementRunStatus =>
  typeof value === 'string' &&
  (SettlementRunStatuses as readonly string[]).includes(value);
