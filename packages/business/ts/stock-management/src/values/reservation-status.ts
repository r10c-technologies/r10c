/**
 * The life of a hold on stock.
 *
 * `held` → `converted` on payment success, `held` → `released` on failure or
 * expiry. Terminal states are kept rather than deleted, because "why did this
 * buyer lose their basket?" is a support question and a deleted row cannot
 * answer it.
 */
export const ReservationStatuses = ['held', 'converted', 'released'] as const;

export type ReservationStatus = (typeof ReservationStatuses)[number];

/** Narrow an unknown value to a reservation status. */
export const isReservationStatus = (
  value: unknown,
): value is ReservationStatus =>
  typeof value === 'string' &&
  (ReservationStatuses as readonly string[]).includes(value);
