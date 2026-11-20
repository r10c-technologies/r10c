import { NotFound } from '@entifix/core';
import { Effect } from 'effect';

import {
  InvalidGuide,
  ShippingOrderNotTransitionable,
} from '../failures/shipping-failures';
import { CourierTrackingTag } from '../ports/courier-tracking';
import { CouriersTag } from '../ports/couriers';
import { ShippingOrderStoreTag } from '../ports/shipping-order-store';
import { guideOf, type GuidePayload } from '../values/courier';
import { RecordGuideUC } from './shipping-order-verbs';

/**
 * A vendor records the guide a parcel leaves with (`record-guide`), checked
 * against the courier dictionary; the last one recorded wins, until the
 * parcel is dispatched (ADR 0081 §11). Recording is not dispatching: a
 * morning's parcels are labelled one by one, then dispatched together.
 */
export const recordGuide = (input: {
  readonly organizationId: string;
  readonly shippingOrderId: string;
  readonly payload: GuidePayload;
}) =>
  Effect.gen(function* () {
    const store = yield* ShippingOrderStoreTag;
    const order = yield* store.get(input.organizationId, input.shippingOrderId);
    if (order === undefined) {
      return yield* new NotFound({ entity: 'shipping-order' });
    }
    yield* RecordGuideUC.run(order);
    const guide = guideOf(input.payload, yield* CouriersTag);
    if (!guide.ok) {
      return yield* new InvalidGuide({
        field: guide.field,
        reason: guide.reason,
      });
    }
    const recorded = yield* store.recordGuide(
      input.organizationId,
      input.shippingOrderId,
      guide.value,
      new Date(),
    );
    if (recorded !== undefined) return recorded;
    // Dispatched, held or withdrawn between the read and the write.
    const now = yield* store.get(input.organizationId, input.shippingOrderId);
    return yield* new ShippingOrderNotTransitionable({
      shippingOrderId: input.shippingOrderId,
      standing: now?.status ?? order.status,
      transition: 'record-guide',
    });
  });

/** The most parcels one pass of the courier feed is asked about. */
export const COURIER_FEED_BATCH = 200;

/**
 * One pass of the courier feed: ask the tracking port about every parcel in
 * transit, and apply each report through the very move a vendor makes —
 * `record-delivery` — so its event answers the delivery flow's wait exactly as
 * a person's report does (ADR 0081 §11). A parcel a vendor already reported on
 * refuses the move, which is not a failure of the pass: the person's report is
 * the real path. Answers how many it applied.
 */
export const applyCourierReports = (now: Date) =>
  Effect.gen(function* () {
    const store = yield* ShippingOrderStoreTag;
    const tracking = yield* CourierTrackingTag;
    const parcels = yield* store.inTransit(COURIER_FEED_BATCH);
    if (parcels.length === 0) return 0;
    const reports = yield* tracking.reports(parcels, now);
    let applied = 0;
    for (const report of reports) {
      const moved = yield* store
        .transition(
          report.organizationId,
          report.shippingOrderId,
          'record-delivery',
          report.at,
          undefined,
        )
        .pipe(
          Effect.as(true),
          Effect.catchTag('ShippingOrderNotTransitionable', () =>
            Effect.succeed(false),
          ),
          Effect.catchTag('NotFound', () => Effect.succeed(false)),
        );
      if (moved) applied += 1;
    }
    return applied;
  });
