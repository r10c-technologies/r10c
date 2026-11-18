import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { ShippingOrder } from '../entities/shipping-order';
import type { ShippingOrderStore } from '../ports/shipping-order-store';
import { ShipmentDestination } from '../values/shipment-destination';
import { ShippingLine } from '../values/shipping-line';
import type { ShippingTransition } from '../values/shipping-transition';

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
    lines: [new ShippingLine('o-1', 'Lámpara Aurora', 2)],
  });

const DESTINATION = Object.assign(new ShipmentDestination(), {
  name: 'Ana López',
  phone: '+50255551234',
  departamento: '01',
  municipio: '0108',
  addressLine: '5a avenida 12-34',
});

/** A shipment with somewhere to go. */
const addressed = (id: string) =>
  Object.assign(aShipment(id), { destination: [DESTINATION] });

const LATER = new Date('2026-11-10T10:00:00.000Z');
const BEFORE = new Date('2026-11-05T00:00:00.000Z');
const SWEPT_AT = new Date('2026-11-06T00:00:00.000Z');

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
        lines: [{ offeringId: 'o-1', name: 'Lámpara Aurora', quantity: 2 }],
      });
      expect(await run(store.get(ORG, 's-2'))).toBeUndefined();
      expect(await run(store.get('org-2', 's-1'))).toBeUndefined();
    });

    it('moves from dispatch to delivery, stamping each moment', async () => {
      const store = await make();
      await run(store.open(ORG, aShipment('s-1'), undefined));

      await run(store.transition(ORG, 's-1', 'dispatch', AT, undefined));
      const delivered = await run(
        store.transition(ORG, 's-1', 'record-delivery', AT, undefined),
      );

      expect(delivered).toMatchObject({
        status: 'delivered',
        dispatchedAt: AT,
        deliveredAt: AT,
      });
      // The packing list still reads as what was sold (#582).
      expect(delivered?.lines.map(line => line.name)).toEqual([
        'Lámpara Aurora',
      ]);
    });

    it('moves from dispatch to refusal to return, stamping each moment', async () => {
      const store = await make();
      await run(store.open(ORG, aShipment('s-1'), undefined));

      await run(store.transition(ORG, 's-1', 'dispatch', AT, undefined));
      await run(store.transition(ORG, 's-1', 'record-refusal', AT, undefined));
      const returned = await run(
        store.transition(ORG, 's-1', 'record-return', AT, undefined),
      );

      expect(returned).toMatchObject({
        status: 'returned',
        dispatchedAt: AT,
        refusedAt: AT,
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

    it('removes the destination of a parcel whose journey ended before the dial, and its remembered copy', async () => {
      const store = await make();
      const move = (id: string, transition: ShippingTransition, at = AT) =>
        run(store.transition(ORG, id, transition, at, undefined));
      // Delivered, returned and withdrawn before the dial: each redacted.
      await run(store.open(ORG, addressed('s-1'), 'open-1'));
      await move('s-1', 'dispatch');
      await move('s-1', 'record-delivery');
      await run(store.open(ORG, addressed('s-2'), undefined));
      await move('s-2', 'dispatch');
      await move('s-2', 'record-refusal');
      await move('s-2', 'record-return');
      await run(store.open('org-2', addressed('s-3'), undefined));
      await run(store.transition('org-2', 's-3', 'withdraw', AT, undefined));
      // Still on its way, back, or closed after the dial: each kept.
      await run(store.open(ORG, addressed('s-4'), undefined));
      await move('s-4', 'dispatch');
      await run(store.open(ORG, addressed('s-5'), undefined));
      await move('s-5', 'dispatch');
      await move('s-5', 'record-refusal');
      await run(store.open(ORG, addressed('s-6'), undefined));
      await move('s-6', 'dispatch', LATER);
      await move('s-6', 'record-delivery', LATER);

      const sweep = await run(store.redactClosedBefore(BEFORE, SWEPT_AT));

      expect(sweep).toEqual({ redacted: 3, failed: [] });
      for (const [organizationId, id] of [
        [ORG, 's-1'],
        [ORG, 's-2'],
        ['org-2', 's-3'],
      ] as const) {
        const shipment = await run(store.get(organizationId, id));
        expect(shipment?.destination).toEqual([]);
        expect(new Date(shipment?.redactedAt as Date).toISOString()).toBe(
          SWEPT_AT.toISOString(),
        );
      }
      for (const id of ['s-4', 's-5', 's-6']) {
        const shipment = await run(store.get(ORG, id));
        expect(shipment?.destination).toHaveLength(1);
        expect(shipment?.redactedAt).toBeUndefined();
      }
      // A redelivered opening is answered with the redacted copy.
      const replayed = await run(store.open(ORG, addressed('s-1'), 'open-1'));
      expect(replayed.order.destination).toEqual([]);
      // A second pass finds nothing left to remove.
      expect(await run(store.redactClosedBefore(BEFORE, SWEPT_AT))).toEqual({
        redacted: 0,
        failed: [],
      });
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
