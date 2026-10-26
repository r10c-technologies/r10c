import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { ProductOrder } from '../entities/product-order';
import type { ProductOrderStore } from '../ports/product-order-store';
import { OrderItem } from '../values/order-item';

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

const anOrder = (id: string) =>
  Object.assign(new ProductOrder('buyer-1'), {
    id,
    status: 'pending',
    items: [new OrderItem('o-1', 'v-1', 2, 10, 'GTQ')],
  });

const paid = { consumer: 'order', eventId: 'e-1' };

/**
 * What every {@link ProductOrderStore} must guarantee, through the port alone.
 * - A placement answers its redelivery with the first order.
 * - An order moves only along `pending → paid → cancelling → cancelled`, each
 *   step conditional on the one before; a claim releases back to `paid`.
 * - A payment event is folded once.
 *
 * `make` returns a fresh, empty store.
 *
 * Deliberately not asserted: two concurrent cancellation claims producing one
 * winner, which is the conditional write against a real server (ADR 0063).
 * The sequential case — a second claim finding nothing to claim — is below.
 */
export const describeProductOrderStoreContract = (
  name: string,
  make: () => ProductOrderStore | Promise<ProductOrderStore>,
) => {
  describe(`${name} honours the ProductOrderStore contract`, () => {
    it('places an order, reads it back, and answers a redelivery with the first order', async () => {
      const store = await make();

      const placed = await run(store.place(anOrder('ord-1'), 'c-1'));
      const again = await run(store.place(anOrder('ord-2'), 'c-1'));

      expect(placed).toMatchObject({ _tag: 'placed', order: { id: 'ord-1' } });
      expect(again).toMatchObject({ _tag: 'replayed', order: { id: 'ord-1' } });
      expect(await run(store.get('ord-1'))).toMatchObject({
        id: 'ord-1',
        status: 'pending',
        items: [{ offeringId: 'o-1', vendorId: 'v-1', quantity: 2 }],
      });
      expect(await run(store.get('ord-2'))).toBeUndefined();
    });

    it('removes an order once', async () => {
      const store = await make();
      await run(store.place(anOrder('ord-1'), undefined));

      expect(await run(store.remove('ord-1'))).toBe(true);
      expect(await run(store.remove('ord-1'))).toBe(false);
      expect(await run(store.get('ord-1'))).toBeUndefined();
    });

    it('folds a payment once, and only into a pending order', async () => {
      const store = await make();
      await run(store.place(anOrder('ord-1'), undefined));

      const first = await run(
        store.markPaid(paid, 'ord-1', '2026-10-26T10:00:00.000Z'),
      );
      const again = await run(
        store.markPaid(paid, 'ord-1', '2026-10-26T11:00:00.000Z'),
      );

      const later = await run(
        store.markPaid(
          { ...paid, eventId: 'e-2' },
          'ord-1',
          '2026-10-26T12:00:00.000Z',
        ),
      );

      expect([first, again, later]).toEqual([
        'claimed',
        'duplicate',
        'claimed',
      ]);
      const order = await run(store.get('ord-1'));
      expect(order?.status).toBe('paid');
      expect(new Date(order?.paidAt as Date).toISOString()).toBe(
        '2026-10-26T10:00:00.000Z',
      );
    });

    it('fulfils a paid order, and nothing that is not paid', async () => {
      const store = await make();
      await run(store.place(anOrder('ord-1'), undefined));
      const shipped = [
        Object.assign(new OrderItem('o-1', 'v-1', 2, 10, 'GTQ'), {
          fulfilledAt: new Date('2026-10-26T12:00:00.000Z'),
        }),
      ];

      const early = await run(store.fulfil('ord-1', shipped, 'fulfilled'));
      await run(store.markPaid(paid, 'ord-1', '2026-10-26T10:00:00.000Z'));
      const fulfilled = await run(store.fulfil('ord-1', shipped, 'fulfilled'));

      expect(early).toBeUndefined();
      expect(fulfilled?.status).toBe('fulfilled');
      expect(
        new Date(fulfilled?.items[0]?.fulfilledAt as Date).toISOString(),
      ).toBe('2026-10-26T12:00:00.000Z');
    });

    it('claims a paid order for cancellation once, replays the claiming command, and refuses another', async () => {
      const store = await make();
      await run(store.place(anOrder('ord-1'), undefined));
      const unpaid = await run(store.claimCancellation('ord-1', 'k-0'));
      await run(store.markPaid(paid, 'ord-1', '2026-10-26T10:00:00.000Z'));

      const claimed = await run(store.claimCancellation('ord-1', 'k-1'));
      const replayed = await run(store.claimCancellation('ord-1', 'k-1'));
      const other = await run(store.claimCancellation('ord-1', 'k-2'));

      expect(unpaid).toEqual({ _tag: 'notClaimable' });
      expect(claimed).toMatchObject({
        _tag: 'claimed',
        order: { id: 'ord-1', status: 'cancelling' },
      });
      expect(replayed).toEqual({ _tag: 'replayed' });
      expect(other).toEqual({ _tag: 'notClaimable' });
    });

    it('releases a claim back to paid, once', async () => {
      const store = await make();
      await run(store.place(anOrder('ord-1'), undefined));
      await run(store.markPaid(paid, 'ord-1', '2026-10-26T10:00:00.000Z'));
      await run(store.claimCancellation('ord-1', undefined));

      expect(await run(store.releaseCancellation('ord-1'))).toBe(true);
      expect(await run(store.releaseCancellation('ord-1'))).toBe(false);
      expect(await run(store.get('ord-1'))).toMatchObject({ status: 'paid' });
    });

    it('settles a claimed cancellation once, and nothing unclaimed', async () => {
      const store = await make();
      await run(store.place(anOrder('ord-1'), undefined));
      await run(store.markPaid(paid, 'ord-1', '2026-10-26T10:00:00.000Z'));

      const unclaimed = await run(store.settleCancellation('ord-1', 's-0'));
      await run(store.claimCancellation('ord-1', undefined));
      const settled = await run(store.settleCancellation('ord-1', 's-1'));
      const redelivered = await run(store.settleCancellation('ord-1', 's-1'));
      const again = await run(store.settleCancellation('ord-1', undefined));

      expect(unclaimed).toBeUndefined();
      expect(settled).toMatchObject({ id: 'ord-1', status: 'cancelled' });
      expect(redelivered).toBeUndefined();
      expect(again).toBeUndefined();
    });
  });
};
