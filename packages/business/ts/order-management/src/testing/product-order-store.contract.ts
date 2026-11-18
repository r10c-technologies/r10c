import { ORDER_NUMBER } from '@r10c/business-ts-order-contracts';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { CheckoutGroup } from '../entities/checkout-group';
import { ProductOrder } from '../entities/product-order';
import type {
  CheckoutGroupStore,
  ProductOrderStore,
} from '../ports/product-order-store';
import { checkoutContactOf } from '../values/checkout-contact';
import { GroupTotal } from '../values/group-total';
import { OrderItem } from '../values/order-item';

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

const GROUP = 'grp-1';

const aGroup = (id = GROUP) =>
  Object.assign(new CheckoutGroup(), {
    id,
    buyerId: 'buyer-1',
    totals: [new GroupTotal(40, 'GTQ')],
    placedAt: new Date('2026-10-26T09:00:00.000Z'),
  });

const anOrder = (id: string, vendorId = 'v-1', groupId = GROUP) =>
  Object.assign(new ProductOrder('buyer-1'), {
    id,
    vendorId,
    groupId,
    paymentMethod: 'card',
    status: 'pending',
    items: [new OrderItem('o-1', 'Lámpara Aurora', 2, 10, 'GTQ')],
  });

const CONTACT = checkoutContactOf({
  name: 'Ana López',
  phone: '+50255551234',
  email: 'ana@correo.com',
  destination: {
    departamento: '01',
    municipio: '0108',
    addressLine: '5a avenida 12-34',
  },
});

/** A group with a buyer to reach, whose receipt window ends at `endsAt`. */
const aContactedGroup = (endsAt: Date, id = GROUP) =>
  Object.assign(aGroup(id), {
    contact: [CONTACT],
    receiptEndsAt: endsAt,
  });

const ENDED = new Date('2026-11-01T00:00:00.000Z');
const SWEPT_AT = new Date('2026-11-02T00:00:00.000Z');

const paid = { consumer: 'order', eventId: 'e-1' };
const PAID_AT = '2026-10-26T10:00:00.000Z';

/** The two stores over one `order` store, as one world. */
export interface OrderStores {
  readonly orders: ProductOrderStore;
  readonly groups: CheckoutGroupStore;
}

/**
 * What every pair of order stores must guarantee, through the ports alone.
 * - A group opens once; an order is placed only into a group that exists, and
 *   joins it; removing the order takes it out again.
 * - An order moves only along its lifecycle, each move conditional on the
 *   statuses it is legal from; a claim releases back to where it came from.
 * - A payment event is folded once.
 *
 * `make` returns fresh, empty stores.
 *
 * Deliberately not asserted: two concurrent cancellation claims producing one
 * winner, which is the conditional write against a real server (ADR 0063).
 */
export const describeProductOrderStoreContract = (
  name: string,
  make: () => OrderStores | Promise<OrderStores>,
) => {
  describe(`${name} honours the order store contract`, () => {
    const placed = async () => {
      const stores = await make();
      await run(stores.groups.open(aGroup(), undefined));
      await run(stores.orders.place(anOrder('ord-1'), undefined));
      return stores;
    };

    it('opens a group once, and answers a redelivery with the first', async () => {
      const { groups } = await make();

      const opened = await run(groups.open(aGroup(), 'g-1'));
      const again = await run(groups.open(aGroup('grp-2'), 'g-1'));

      expect(opened).toMatchObject({ _tag: 'opened', group: { id: GROUP } });
      expect(again).toMatchObject({ _tag: 'replayed', group: { id: GROUP } });
      expect(await run(groups.get(GROUP))).toMatchObject({
        buyerId: 'buyer-1',
        totals: [{ amount: 40, currency: 'GTQ' }],
      });
      expect(await run(groups.get('grp-2'))).toBeUndefined();
    });

    const AT = new Date('2026-10-26T09:00:00.000Z');
    const later = (seconds: number) => new Date(AT.getTime() + seconds * 1000);
    const grant = (digest: string, sentAt = AT) => ({
      digest,
      expiresAt: later(3600),
      sentAt,
    });

    it('stores an access link, and lets the interval refuse a second one', async () => {
      const { groups } = await make();
      await run(groups.open(aGroup(), undefined));

      const first = await run(groups.issueAccess(GROUP, grant('d-1')));
      const tooSoon = await run(
        groups.issueAccess(GROUP, grant('d-2', later(10)), later(-300)),
      );
      const afterInterval = await run(
        groups.issueAccess(GROUP, grant('d-3', later(400)), later(100)),
      );
      const missing = await run(groups.issueAccess('nobody', grant('d-4')));

      expect([first?.id, first?.accessDigest]).toEqual([GROUP, 'd-1']);
      expect(tooSoon).toBeUndefined();
      expect(afterInterval?.accessDigest).toBe('d-3');
      expect(missing).toBeUndefined();
      const stored = await run(groups.get(GROUP));
      expect(stored?.accessDigest).toBe('d-3');
      expect(stored?.accessSentAt?.getTime()).toBe(later(400).getTime());
    });

    it('redeems an access link once, before it expires, into a new cancel digest', async () => {
      const { groups } = await make();
      await run(groups.open(aGroup(), undefined));
      await run(groups.issueAccess(GROUP, grant('d-1')));

      const wrong = await run(groups.redeemAccess('d-x', 'c-new', later(1)));
      const expired = await run(
        groups.redeemAccess('d-1', 'c-new', later(3600)),
      );
      const redeemed = await run(groups.redeemAccess('d-1', 'c-new', later(1)));
      const spent = await run(groups.redeemAccess('d-1', 'c-other', later(2)));

      expect([wrong, expired, redeemed, spent]).toEqual([
        undefined,
        undefined,
        GROUP,
        undefined,
      ]);
      const group = await run(groups.get(GROUP));
      expect(group?.cancelDigest).toBe('c-new');
      expect(group?.accessDigest).toBeUndefined();
      expect(group?.accessExpiresAt).toBeUndefined();
      expect(group?.accessSentAt?.getTime()).toBe(AT.getTime());
    });

    it('finds a group by its own number or by one of its orders’', async () => {
      const { orders, groups } = await placed();
      const group = await run(groups.get(GROUP));
      const order = await run(orders.get('ord-1'));

      expect((await run(groups.findByNumber(String(group?.number))))?.id).toBe(
        GROUP,
      );
      expect((await run(groups.findByNumber(String(order?.number))))?.id).toBe(
        GROUP,
      );
      expect(await run(groups.findByNumber('ZZZZ-ZZZZ'))).toBeUndefined();
    });

    it('removes the contact of an ended receipt whose orders are all closed, and its remembered copy', async () => {
      const { orders, groups } = await make();
      await run(groups.open(aContactedGroup(ENDED), 'open-1'));
      // Other remembered commands, which the sweep must leave as they are: an
      // order's placement, and another group's opening.
      await run(orders.place(anOrder('ord-1'), 'place-1'));
      await run(
        groups.open(aContactedGroup(new Date('2026-12-01'), 'grp-2'), 'open-2'),
      );
      await run(orders.move('ord-1', 'confirm', undefined));
      await run(orders.move('ord-1', 'mark-dispatched', undefined));
      await run(orders.move('ord-1', 'close-fulfilled', undefined));

      expect(await run(groups.redactEndedReceipts(SWEPT_AT))).toBe(1);
      const group = await run(groups.get(GROUP));
      expect(group?.contact).toEqual([]);
      expect(new Date(group?.redactedAt as Date).toISOString()).toBe(
        SWEPT_AT.toISOString(),
      );
      // A redelivered opening is answered with the redacted copy.
      const replayed = await run(groups.open(aContactedGroup(ENDED), 'open-1'));
      expect(replayed).toMatchObject({ _tag: 'replayed' });
      expect((replayed as { group: CheckoutGroup }).group.contact).toEqual([]);
      const other = await run(groups.open(aContactedGroup(ENDED), 'open-2'));
      expect((other as { group: CheckoutGroup }).group.contact).toHaveLength(1);
      // A second pass finds nothing left to remove.
      expect(await run(groups.redactEndedReceipts(SWEPT_AT))).toBe(0);
    });

    it('keeps the contact while a receipt is open, or while any order is', async () => {
      const { orders, groups } = await make();
      await run(groups.open(aContactedGroup(ENDED), undefined));
      await run(orders.place(anOrder('ord-1'), undefined));
      await run(
        groups.open(
          aContactedGroup(new Date('2026-12-01'), 'grp-2'),
          undefined,
        ),
      );
      await run(orders.place(anOrder('ord-2', 'v-1', 'grp-2'), undefined));
      await run(orders.move('ord-2', 'confirm', undefined));
      await run(orders.move('ord-2', 'mark-dispatched', undefined));
      await run(orders.move('ord-2', 'close-fulfilled', undefined));

      expect(await run(groups.redactEndedReceipts(SWEPT_AT))).toBe(0);
      expect((await run(groups.get(GROUP)))?.contact).toHaveLength(1);
      expect((await run(groups.get('grp-2')))?.contact).toHaveLength(1);
      expect((await run(groups.get(GROUP)))?.redactedAt).toBeUndefined();
    });

    it('places each vendor’s order into its group, and reads them back together', async () => {
      const { orders, groups } = await make();
      await run(groups.open(aGroup(), undefined));

      const first = await run(orders.place(anOrder('ord-1', 'v-1'), 'c-1'));
      const again = await run(orders.place(anOrder('ord-9', 'v-1'), 'c-1'));
      await run(orders.place(anOrder('ord-2', 'v-2'), 'c-2'));

      expect(first).toMatchObject({ _tag: 'placed', order: { id: 'ord-1' } });
      expect(again).toMatchObject({ _tag: 'replayed', order: { id: 'ord-1' } });
      expect((await run(groups.get(GROUP)))?.orderIds).toEqual([
        'ord-1',
        'ord-2',
      ]);
      expect(
        (await run(orders.forGroup(GROUP))).map(order => order.vendorId),
      ).toEqual(['v-1', 'v-2']);
      expect(await run(orders.get('ord-1'))).toMatchObject({
        vendorId: 'v-1',
        groupId: GROUP,
        paymentMethod: 'card',
        items: [{ offeringId: 'o-1', name: 'Lámpara Aurora', quantity: 2 }],
      });
    });

    it('redraws a group or an order number another record already holds', async () => {
      const { orders, groups } = await make();
      const taken = 'AAAA-AAAA';

      await run(
        groups.open(Object.assign(aGroup(), { number: taken }), undefined),
      );
      const second = await run(
        groups.open(
          Object.assign(aGroup('grp-2'), { number: taken }),
          undefined,
        ),
      );
      await run(
        orders.place(
          Object.assign(anOrder('ord-1'), { number: taken }),
          undefined,
        ),
      );
      const other = await run(
        orders.place(
          Object.assign(anOrder('ord-2'), { number: taken }),
          undefined,
        ),
      );

      const groupNumbers = [
        (await run(groups.get(GROUP)))?.number,
        (await run(groups.get('grp-2')))?.number,
      ];
      const orderNumbers = (await run(orders.forGroup(GROUP))).map(
        order => order.number,
      );
      expect(groupNumbers[0]).toBe(taken);
      expect(groupNumbers[1]).toMatch(ORDER_NUMBER);
      expect(groupNumbers[1]).not.toBe(taken);
      expect(second._tag === 'opened' && second.group.number).toBe(
        groupNumbers[1],
      );
      expect(orderNumbers).toHaveLength(2);
      expect(new Set(orderNumbers).size).toBe(2);
      expect(other._tag === 'placed' && other.order.number).not.toBe(taken);
    });

    it('answers a replayed command with the number it first drew', async () => {
      const { orders, groups } = await make();

      const opened = await run(
        groups.open(Object.assign(aGroup(), { number: 'GRP0-0001' }), 'g-1'),
      );
      const reopened = await run(
        groups.open(Object.assign(aGroup(), { number: 'GRP0-0002' }), 'g-1'),
      );
      await run(
        orders.place(
          Object.assign(anOrder('ord-1'), { number: '0RD0-0001' }),
          'c-1',
        ),
      );
      const replayed = await run(
        orders.place(
          Object.assign(anOrder('ord-9'), { number: '0RD0-0002' }),
          'c-1',
        ),
      );

      expect(opened).toMatchObject({ group: { number: 'GRP0-0001' } });
      expect(reopened).toMatchObject({
        _tag: 'replayed',
        group: { number: 'GRP0-0001' },
      });
      expect(replayed).toMatchObject({
        _tag: 'replayed',
        order: { id: 'ord-1', number: '0RD0-0001' },
      });
    });

    it('refuses an order for a group that was never opened', async () => {
      const { orders } = await make();

      const refused = await run(
        Effect.flip(orders.place(anOrder('ord-1'), undefined)),
      );

      expect(refused).toMatchObject({ code: 'notFound' });
      expect(await run(orders.get('ord-1'))).toBeUndefined();
    });

    it('removes an order once, and its group by the group’s own compensation', async () => {
      const { orders, groups } = await placed();

      expect(await run(orders.remove('ord-1'))).toBe(true);
      expect(await run(orders.remove('ord-1'))).toBe(false);
      expect(await run(orders.get('ord-1'))).toBeUndefined();
      expect(await run(groups.remove(GROUP))).toBe(true);
      expect(await run(groups.remove(GROUP))).toBe(false);
    });

    it('folds a payment once, and only into a pending order', async () => {
      const { orders } = await placed();

      const first = await run(orders.markPaid(paid, 'ord-1', PAID_AT));
      const again = await run(
        orders.markPaid(paid, 'ord-1', '2026-10-26T11:00:00.000Z'),
      );

      expect([first, again]).toEqual(['claimed', 'duplicate']);
      // An order nobody placed is claimed and left alone.
      expect(
        await run(
          orders.markPaid({ ...paid, eventId: 'e-9' }, 'nope', PAID_AT),
        ),
      ).toBe('claimed');
      const order = await run(orders.get('ord-1'));
      expect(order?.status).toBe('paid');
      expect(new Date(order?.paidAt as Date).toISOString()).toBe(PAID_AT);
    });

    it('confirms, dispatches and fulfils an order, each move only from where it is legal', async () => {
      const { orders } = await placed();

      const early = await run(
        orders.move('ord-1', 'mark-dispatched', undefined),
      );
      const confirmed = await run(orders.move('ord-1', 'confirm', 'm-1'));
      const replayed = await run(orders.move('ord-1', 'confirm', 'm-1'));
      await run(orders.move('ord-1', 'mark-dispatched', undefined));
      const fulfilled = await run(
        orders.move('ord-1', 'close-fulfilled', undefined),
      );

      expect(early).toBeUndefined();
      // Confirmed straight from pending: a cash-on-delivery order takes no money.
      expect(confirmed?.status).toBe('confirmed');
      expect(replayed?.status).toBe('confirmed');
      expect(fulfilled?.status).toBe('fulfilled');
      // Each line keeps the name it was sold under through every move (#582).
      expect(fulfilled?.items.map(item => item.name)).toEqual([
        'Lámpara Aurora',
      ]);
      expect(
        await run(orders.move('nope', 'confirm', undefined)),
      ).toBeUndefined();
    });

    it('claims a paid or confirmed order once, replays the claiming command, and refuses another', async () => {
      const { orders } = await placed();
      const unpaid = await run(orders.claimCancellation('ord-1', 'k-0'));
      await run(orders.markPaid(paid, 'ord-1', PAID_AT));

      const claimed = await run(orders.claimCancellation('ord-1', 'k-1'));
      const replayed = await run(orders.claimCancellation('ord-1', 'k-1'));
      const other = await run(orders.claimCancellation('ord-1', 'k-2'));

      expect(unpaid).toEqual({ _tag: 'notClaimable' });
      expect(await run(orders.claimCancellation('nope', undefined))).toEqual({
        _tag: 'notClaimable',
      });
      expect(claimed).toMatchObject({
        _tag: 'claimed',
        order: { id: 'ord-1', status: 'cancelling' },
      });
      expect(replayed).toEqual({ _tag: 'replayed' });
      expect(other).toEqual({ _tag: 'notClaimable' });
    });

    it('releases a claim back to the status it was claimed from, once', async () => {
      const { orders } = await placed();
      await run(orders.move('ord-1', 'confirm', undefined));
      await run(orders.claimCancellation('ord-1', undefined));

      expect(await run(orders.releaseCancellation('ord-1'))).toBe(true);
      expect(await run(orders.releaseCancellation('ord-1'))).toBe(false);
      expect(await run(orders.get('ord-1'))).toMatchObject({
        status: 'confirmed',
      });
    });

    it('settles a claimed cancellation once, and nothing unclaimed', async () => {
      const { orders } = await placed();
      await run(orders.markPaid(paid, 'ord-1', PAID_AT));

      const unclaimed = await run(orders.settleCancellation('ord-1', 's-0'));
      await run(orders.claimCancellation('ord-1', undefined));
      const settled = await run(orders.settleCancellation('ord-1', 's-1'));
      const redelivered = await run(orders.settleCancellation('ord-1', 's-1'));
      const again = await run(orders.settleCancellation('ord-1', undefined));

      expect(unclaimed).toBeUndefined();
      expect(settled).toMatchObject({ id: 'ord-1', status: 'cancelled' });
      expect(redelivered).toBeUndefined();
      expect(again).toBeUndefined();
    });
  });
};
