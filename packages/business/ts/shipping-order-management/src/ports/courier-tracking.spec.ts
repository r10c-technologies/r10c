import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { simulatedCourierTracking } from './courier-tracking.js';

const parcel = (id: string, dispatchedAt: string) => ({
  organizationId: 'org-1',
  shippingOrderId: id,
  courierKey: 'other',
  trackingNumber: `G-${id}`,
  dispatchedAt: new Date(dispatchedAt),
});

describe('simulatedCourierTracking', () => {
  it('reports delivered every parcel whose delay ran out, at the moment it did', async () => {
    const tracking = simulatedCourierTracking(60_000);

    const reports = await Effect.runPromise(
      tracking.reports(
        [
          parcel('a', '2026-11-19T10:00:00.000Z'),
          parcel('b', '2026-11-19T10:00:30.000Z'),
        ],
        new Date('2026-11-19T10:01:00.000Z'),
      ),
    );

    expect(reports).toEqual([
      {
        organizationId: 'org-1',
        shippingOrderId: 'a',
        trackingNumber: 'G-a',
        outcome: 'delivered',
        at: new Date('2026-11-19T10:01:00.000Z'),
      },
    ]);
  });
});
