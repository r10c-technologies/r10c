import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { ShippingOrder } from '../entities/shipping-order';
import type { ShippingOrderStore } from '../ports/shipping-order-store';
import { ShippingLine } from '../values/shipping-line';

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

const ORG = 'org-1';
const AT = new Date('2026-11-03T10:00:00.000Z');

const aShipment = (id: string) =>
  Object.assign(new ShippingOrder(), {
    id,
    orderId: `order-${id}`,
    groupId: 'group-1',
    paymentMethod: 'cod',
    amountDue: 2500,
    currency: 'GTQ',
    lines: [new ShippingLine('o-1', 2)],
  });

/** The code a refused move failed with. */
const refusal = async <A, E>(effect: Effect.Effect<A, E>) =>
  ((await Effect.runPromise(Effect.flip(effect))) as { code?: string }).code;

/**
 * What every {@link ShippingOrderStore} must guarantee, through the port alone.
 * - Opening answers its redelivery with the first shipment.
 * - Every move is conditional on the status it is legal from, and stamps its
 *   moment; an illegal move is refused and changes nothing.
 * - A dispatch and a hold on one shipment leave exactly one winner, whichever
 *   lands first. Deliberately sequential: two truly concurrent writes are the
 *   conditional write against a real server, proved in the live pass (ADR 0063).
 * - A repeated command answers the record as its first delivery left it.
 *
 * `make` returns a fresh, empty store.
 */
export const describeShippingOrderStoreContract = (
  name: string,
  make: () => ShippingOrderStore | Promise<ShippingOrderStore>,
) => {
  describe(`${name} honours the ShippingOrderStore contract`, () => {
    it('opens a shipment awaiting dispatch, and answers a redelivery with the first', async () => {
      const store = await make();

      const opened = await run(store.open(ORG, aShipment('s-1'), 'c-1'));
      const again = await run(store.open(ORG, aShipment('s-2'), 'c-1'));

      expect(opened).toMatchObject({
        _tag: 'opened',
        order: { id: 's-1', status: 'awaiting-dispatch' },
      });
      expect(again).toMatchObject({ _tag: 'replayed', order: { id: 's-1' } });
      expect(await run(store.get(ORG, 's-1'))).toMatchObject({
        orderId: 'order-s-1',
        paymentMethod: 'cod',
        amountDue: 2500,
        lines: [{ offeringId: 'o-1', quantity: 2 }],
      });
      expect(await run(store.get(ORG, 's-2'))).toBeUndefined();
      expect(await run(store.get('org-2', 's-1'))).toBeUndefined();
    });

    it('moves from dispatch to delivery to return, stamping each moment', async () => {
      const store = await make();
      await run(store.open(ORG, aShipment('s-1'), undefined));

      await run(store.transition(ORG, 's-1', 'dispatch', AT, undefined));
      await run(store.transition(ORG, 's-1', 'record-delivery', AT, undefined));
      const returned = await run(
        store.transition(ORG, 's-1', 'record-return', AT, undefined),
      );

      expect(returned).toMatchObject({
        status: 'returned',
        dispatchedAt: AT,
        deliveredAt: AT,
        returnedAt: AT,
      });
    });

    it('refuses an illegal move and an unknown shipment, changing nothing', async () => {
      const store = await make();
      await run(store.open(ORG, aShipment('s-1'), undefined));

      const early = await refusal(
        store.transition(ORG, 's-1', 'record-delivery', AT, undefined),
      );
      const missing = await refusal(
        store.transition(ORG, 'nope', 'dispatch', AT, undefined),
      );

      expect(early).toBe('shippingOrderNotTransitionable');
      expect(missing).toBe('notFound');
      expect(await run(store.get(ORG, 's-1'))).toMatchObject({
        status: 'awaiting-dispatch',
      });
    });

    it('refuses a dispatch while held, and allows it once released', async () => {
      const store = await make();
      await run(store.open(ORG, aShipment('s-1'), undefined));

      await run(store.transition(ORG, 's-1', 'hold', AT, undefined));
      const refused = await refusal(
        store.transition(ORG, 's-1', 'dispatch', AT, undefined),
      );
      await run(store.transition(ORG, 's-1', 'release', AT, undefined));
      const dispatched = await run(
        store.transition(ORG, 's-1', 'dispatch', AT, undefined),
      );

      expect(refused).toBe('shippingOrderNotTransitionable');
      expect(dispatched.status).toBe('dispatched');
    });

    it('leaves exactly one winner of a dispatch and a hold, whichever lands first', async () => {
      for (const [first, second] of [
        ['dispatch', 'hold'],
        ['hold', 'dispatch'],
      ] as const) {
        const store = await make();
        await run(store.open(ORG, aShipment('s-1'), undefined));

        const outcomes = await Promise.allSettled([
          run(store.transition(ORG, 's-1', first, AT, `${first}-1`)),
        ]).then(async won => [
          ...won,
          ...(await Promise.allSettled([
            run(store.transition(ORG, 's-1', second, AT, `${second}-1`)),
          ])),
        ]);

        expect(outcomes.map(outcome => outcome.status)).toEqual([
          'fulfilled',
          'rejected',
        ]);
      }
    });

    it('answers a repeated command with the record its first delivery left', async () => {
      const store = await make();
      await run(store.open(ORG, aShipment('s-1'), undefined));

      const first = await run(
        store.transition(ORG, 's-1', 'withdraw', AT, 'w-1'),
      );
      const again = await run(
        store.transition(ORG, 's-1', 'withdraw', AT, 'w-1'),
      );

      expect(first.status).toBe('withdrawn');
      expect(again.status).toBe('withdrawn');
    });
  });
};
