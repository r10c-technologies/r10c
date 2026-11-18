import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@entifix/core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { CheckoutContact } from '../../values/checkout-contact.js';
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

  it('reads its amounts as money in minor units of its own currency', () => {
    // Every amount in the fleet is stored in minor units. Without `money`, a
    // generated table prints 5499 where a person reads Q54.99.
    const columns = describeEntityColumns(GroupTotal);
    for (const name of ['amount']) {
      expect(columns.find(column => column.name === name)?.money).toEqual({
        unit: 'minor',
        currencyMember: 'currency',
      });
    }
  });

  it('round-trips the buyer’s contact, the locale and when the contact was removed', async () => {
    const contact = Object.assign(new CheckoutContact(), {
      name: 'Ana',
      phone: '+50255551234',
      email: 'ana@correo.com',
      departamento: '01',
      municipio: '0101',
      zona: 10,
      addressLine: '5a avenida',
      reference: 'portón negro',
    });
    const revived = await Effect.runPromise(
      deserializeSingleEntity(CheckoutGroup, {
        ...serializeEntity(
          CheckoutGroup,
          Object.assign(aGroup(), {
            contact: [contact],
            locale: 'es',
            redactedAt: ENDS,
          }),
        ),
        id: 'group-1',
      }),
    );

    expect(revived?.contact).toEqual([
      expect.objectContaining({
        name: 'Ana',
        phone: '+50255551234',
        email: 'ana@correo.com',
        departamento: '01',
        municipio: '0101',
        zona: 10,
        addressLine: '5a avenida',
        reference: 'portón negro',
      }),
    ]);
    expect(revived?.locale).toBe('es');
    expect(revived?.redactedAt).toEqual(ENDS);
  });

  it('keeps the contact out of every filter and sort', () => {
    const contact = describeEntityColumns(CheckoutGroup).find(
      column => column.name === 'contact',
    );
    expect(contact).toMatchObject({ filterable: false, sortable: false });
  });
});
