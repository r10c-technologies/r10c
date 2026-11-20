import type { StoreFailure } from '@entifix/core';
import { Context, Effect } from 'effect';

/** A parcel on its way: dispatched, and not yet reported on. */
export interface ParcelInTransit {
  readonly organizationId: string;
  readonly shippingOrderId: string;
  readonly courierKey: string;
  readonly trackingNumber: string;
  readonly dispatchedAt: Date;
}

/**
 * What a courier says about one parcel, in the shape a real integration
 * answers — its tracking number, what happened and when. Only `delivered` is
 * reported here: a refusal and a return are a person's to record, because each
 * one moves money or stock (ADR 0070).
 */
export interface CourierReport {
  readonly organizationId: string;
  readonly shippingOrderId: string;
  readonly trackingNumber: string;
  readonly outcome: 'delivered';
  readonly at: Date;
}

/**
 * A courier's tracking feed (ADR 0081 §11). Asked about the parcels in
 * transit, it answers the reports it has for them. The lab's adapter is a
 * simulator; a real courier's is a poll or a webhook behind the same shape. A
 * report is applied through the very move a vendor makes, `record-delivery`,
 * so the person's report stays the real path and this one only saves them a
 * click.
 */
export interface CourierTracking {
  readonly reports: (
    parcels: readonly ParcelInTransit[],
    now: Date,
  ) => Effect.Effect<readonly CourierReport[], StoreFailure>;
}

export class CourierTrackingTag extends Context.Service<
  CourierTrackingTag,
  CourierTracking
>()('CourierTrackingTag') {}

/**
 * The lab's courier: every parcel in transit for at least `delayMs` is
 * reported delivered at the moment its delay ran out. Deterministic, so a
 * live pass knows when to look, and it never refuses a parcel — a refusal is
 * a person's act.
 */
export const simulatedCourierTracking = (delayMs: number): CourierTracking => ({
  reports: (parcels, now) =>
    Effect.succeed(
      parcels
        .filter(
          parcel => parcel.dispatchedAt.getTime() + delayMs <= now.getTime(),
        )
        .map(parcel => ({
          organizationId: parcel.organizationId,
          shippingOrderId: parcel.shippingOrderId,
          trackingNumber: parcel.trackingNumber,
          outcome: 'delivered' as const,
          at: new Date(parcel.dispatchedAt.getTime() + delayMs),
        })),
    ),
});
