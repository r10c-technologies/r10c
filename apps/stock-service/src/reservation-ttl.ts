import { Context } from 'effect';

/**
 * How long a hold survives without being converted or released, in seconds.
 *
 * Configuration rather than a constant, for the reason `tenant.dbPrefix` is: the
 * convention is stated once, in config-service, where an operator can change it
 * without a deploy. The number is a business trade — too short and a buyer loses
 * their basket mid-payment, too long and stock sits promised to a checkout
 * nobody finished — and it is exactly the kind of value that wants tuning
 * against a real payment provider's latency.
 *
 * ⚠️ **The expiry is server-owned.** A client that could name it could hold a
 * vendor's stock indefinitely, which is a denial of sale rather than a
 * reservation.
 */
export class ReservationTtlSecondsTag extends Context.Tag(
  'ReservationTtlSecondsTag',
)<ReservationTtlSecondsTag, number>() {}
