import type { ShippingStatus } from './shipping-status';

/**
 * Every move a shipping order can make once open.
 *
 * `hold`, `release` and `withdraw` belong to a cancellation flow, `dispatch` to
 * the delivery flow's pivot, and the three `record-*` verbs to the vendor who
 * hears back from the courier. Opening is not a transition: it is the write
 * that creates the record in `awaiting-dispatch`.
 */
export const ShippingTransitions = [
  'hold',
  'release',
  'withdraw',
  'dispatch',
  'record-delivery',
  'record-refusal',
  'record-return',
] as const;

export type ShippingTransition = (typeof ShippingTransitions)[number];

/**
 * The whole lifecycle, as a table — every pair absent here is illegal.
 *
 * Two entries carry the design.
 *
 * **`dispatch` is legal from `awaiting-dispatch` alone.** A `held` order is a
 * cancellation in flight, so a dispatch landing on it must lose; that refusal
 * and the hold's own refusal from `dispatched` are the two halves of one
 * conditional write, and exactly one of a racing dispatch and hold wins.
 *
 * **`record-return` is legal from `refused` alone.** A refused parcel comes
 * back to the vendor and puts its stock back as a `return` movement; a
 * delivered one coming back is a flow of its own, and not this one.
 */
const TRANSITIONS: Record<
  ShippingTransition,
  Partial<Record<ShippingStatus, ShippingStatus>>
> = {
  hold: { 'awaiting-dispatch': 'held' },
  release: { held: 'awaiting-dispatch' },
  withdraw: { 'awaiting-dispatch': 'withdrawn', held: 'withdrawn' },
  dispatch: { 'awaiting-dispatch': 'dispatched' },
  'record-delivery': { dispatched: 'delivered' },
  'record-refusal': { dispatched: 'refused' },
  // Only a refused parcel comes back. One returned after it was delivered
  // has no flow waiting on it — its delivery already closed the order — so it
  // would be a report nothing answers; that return is a flow of its own, and
  // not this one (ADR 0070).
  'record-return': { refused: 'returned' },
};

/** The resulting status, or `undefined` when the move is illegal. */
export function shippingStatusAfter(
  current: ShippingStatus,
  transition: ShippingTransition,
): ShippingStatus | undefined {
  return TRANSITIONS[transition][current];
}

/**
 * Every status a move is legal from — what a verb declares as the states it
 * is offered in, read off this table so the two can never disagree.
 */
export function statusesBefore(
  transition: ShippingTransition,
): readonly ShippingStatus[] {
  return Object.keys(TRANSITIONS[transition]) as ShippingStatus[];
}

/** The stamp a transition writes beside the status, if it writes one. */
export const STAMP_OF: Partial<
  Record<
    ShippingTransition,
    'dispatchedAt' | 'deliveredAt' | 'refusedAt' | 'returnedAt'
  >
> = {
  dispatch: 'dispatchedAt',
  'record-delivery': 'deliveredAt',
  'record-refusal': 'refusedAt',
  'record-return': 'returnedAt',
};
