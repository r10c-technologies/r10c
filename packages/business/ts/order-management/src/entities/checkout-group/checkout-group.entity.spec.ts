import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@entifix/core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { GroupTotal } from '../../values/group-total.js';
import { CheckoutGroup } from './checkout-group.entity.js';

const PLACED = new Date('2026-11-03T09:00:00.000Z');
const ENDS = new Date('2026-11-03T09:30:00.000Z');

const aGroup = () =>
  Object.assign(new CheckoutGroup(), {
    id: 'group-1',
    buyerId: 'buyer-1',
    orderIds: ['order-a', 'order-b'],
    totals: [new GroupTotal(1250, 'GTQ')],
    placedAt: PLACED,
    cancelDigest: 'digest',
    cancelWindowEndsAt: ENDS,
  });

describe('CheckoutGroup', () => {
  it('round-trips the buyer’s receipt: its orders, its totals and its capability digest', async () => {
    const revived = await Effect.runPromise(
      deserializeSingleEntity(CheckoutGroup, {
        ...serializeEntity(CheckoutGroup, aGroup()),
        id: 'group-1',
      }),
    );

    expect(revived).toMatchObject({
      id: 'group-1',
      buyerId: 'buyer-1',
      orderIds: ['order-a', 'order-b'],
      totals: [{ amount: 1250, currency: 'GTQ' }],
      placedAt: PLACED,
      cancelDigest: 'digest',
      cancelWindowEndsAt: ENDS,
    });
  });

  it('starts with no orders and no totals', () => {
    expect(new CheckoutGroup()).toMatchObject({ orderIds: [], totals: [] });
    expect(new GroupTotal()).toMatchObject({ amount: 0, currency: '' });
  });

  it('keeps the digest out of the query allowlist, explicitly', () => {
    const digest = describeEntityColumns(CheckoutGroup).find(
      column => column.name === 'cancelDigest',
    );

    expect(digest).toMatchObject({ filterable: false, sortable: false });
  });
});
