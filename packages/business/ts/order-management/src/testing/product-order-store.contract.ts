import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { CheckoutGroup } from '../entities/checkout-group';
import { ProductOrder } from '../entities/product-order';
import type {
  CheckoutGroupStore,
  ProductOrderStore,
} from '../ports/product-order-store';
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
    items: [new OrderItem('o-1', 2, 10, 'GTQ')],
  });

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
        items: [{ offeringId: 'o-1', quantity: 2 }],
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
