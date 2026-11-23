import type { SaleUnit } from '@r10c/business-ts-sales-vocabulary';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { Reservation } from '../entities/reservation';
import type { StockItem } from '../entities/stock-item';
import { StockMovement } from '../entities/stock-movement';
import type { StockLedger } from '../ports/stock-ledger';
import type { MovementReason } from '../values/movement-reason';

/** Two organizations every subject must keep apart. */
export const CONTRACT_ORGANIZATIONS = ['org-a', 'org-b'] as const;

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
const refusal = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.flip(effect));

const hold = (
  id: string,
  quantity: number,
  expiresAt = new Date(Date.now() + 60_000),
  unit: SaleUnit = 'UN',
) =>
  Object.assign(new Reservation('o-1', quantity), {
    id,
    status: 'held',
    expiresAt,
    unit,
  });

const movement = (
  id: string,
  quantity: number,
  reason: MovementReason = 'receipt',
  unit: SaleUnit = 'UN',
) => Object.assign(new StockMovement('o-1', quantity, reason), { id, unit });

/** Three and a half metres, received: the item is counted in `M` from here. */
const metres = (id: string, quantity = 3500) =>
  movement(id, quantity, 'receipt', 'M');

/**
 * What every {@link StockLedger} must guarantee, observed through the port
 * alone: what is free is what was received less what is held, a hold is taken
 * only from what is free, a command id answers its redelivery with the first
 * decision, ending a hold is idempotent, and two organizations never see each
 * other's shelf.
 *
 * `make` returns a fresh, empty ledger serving both
 * {@link CONTRACT_ORGANIZATIONS}.
 *
 * Deliberately not asserted: two concurrent takes on the last unit producing
 * one winner, or a parallel burst leaving `available` equal to `onHand −
 * reserved`. Both are the conditional write against a real server, and a run
 * in one process cannot interleave them — the fake driver's transactions are
 * atomic, not isolated (ADR 0063). `stock-service-e2e`'s
 * `concurrency.live.spec.ts` proves both against the lab.
 */
export const describeStockLedgerContract = (
  name: string,
  make: () => StockLedger | Promise<StockLedger>,
) => {
  describe(`${name} honours the StockLedger contract`, () => {
    it('holds only what is free, and refuses the rest', async () => {
      const ledger = await make();
      await run(ledger.record('org-a', movement('m-1', 5)));

      const held = await run(ledger.take('org-a', hold('r-1', 3), undefined));
      const refused = await refusal(
        ledger.take('org-a', hold('r-2', 3), undefined),
      );
      const rest = await run(ledger.take('org-a', hold('r-3', 2), undefined));

      expect(held).toMatchObject({ _tag: 'held', reservation: { id: 'r-1' } });
      expect(refused).toMatchObject({
        _tag: 'InsufficientStock',
        code: 'insufficientStock',
        offeringId: 'o-1',
        requested: 3,
        available: 2,
      });
      expect(rest._tag).toBe('held');
    });

    it('counts an item in the unit its first movement stated', async () => {
      const ledger = await make();
      await run(ledger.record('org-a', metres('m-1')));

      expect(await run(ledger.item('org-a', 'o-1'))).toMatchObject({
        unit: 'M',
        onHand: 3500,
        available: 3500,
      });
    });

    it('refuses a movement in another unit, and leaves the counters as they were', async () => {
      const ledger = await make();
      await run(ledger.record('org-a', metres('m-1')));

      const refused = await refusal(
        ledger.record('org-a', movement('m-2', 2, 'receipt', 'UN')),
      );

      expect(refused).toMatchObject({
        _tag: 'UnitMismatch',
        code: 'unitMismatch',
        offeringId: 'o-1',
        unit: 'UN',
        stocked: 'M',
      });
      expect(await run(ledger.item('org-a', 'o-1'))).toMatchObject({
        onHand: 3500,
      });
    });

    it('refuses a hold in another unit as a unit mismatch, never as too little stock', async () => {
      const ledger = await make();
      await run(ledger.record('org-a', metres('m-1')));

      const refused = await refusal(
        ledger.take('org-a', hold('r-1', 1), undefined),
      );

      expect(refused).toMatchObject({
        _tag: 'UnitMismatch',
        unit: 'UN',
        stocked: 'M',
      });
      expect(await run(ledger.item('org-a', 'o-1'))).toMatchObject({
        reserved: 0,
      });
    });

    it('holds and sells in the item’s own unit', async () => {
      const ledger = await make();
      await run(ledger.record('org-a', metres('m-1')));
      const held = hold('r-1', 1500, undefined, 'M');

      await run(ledger.take('org-a', held, undefined));
      await run(ledger.end('org-a', 'r-1', 'converted'));

      expect(await run(ledger.item('org-a', 'o-1'))).toMatchObject({
        unit: 'M',
        onHand: 2000,
        reserved: 0,
        available: 2000,
      });
    });

    it('refuses a restoration in another unit', async () => {
      const ledger = await make();
      await run(ledger.record('org-a', metres('m-1')));

      const refused = await refusal(
        ledger.restore(
          'org-a',
          movement('m-2', 1, 'cancellation', 'UN'),
          'cmd-1',
        ),
      );

      expect(refused).toMatchObject({ _tag: 'UnitMismatch' });
    });

    it('answers a redelivered take with its first hold, and holds once', async () => {
      const ledger = await make();
      await run(ledger.record('org-a', movement('m-1', 4)));

      await run(ledger.take('org-a', hold('r-1', 2), 'c-1'));
      const again = await run(ledger.take('org-a', hold('r-9', 2), 'c-1'));
      const rest = await run(ledger.take('org-a', hold('r-2', 2), undefined));

      expect(again).toMatchObject({
        _tag: 'replayed',
        reservation: { id: 'r-1', quantity: 2 },
      });
      expect(rest._tag).toBe('held');
    });

    it('gives a released hold back, and answers a second release not-held', async () => {
      const ledger = await make();
      await run(ledger.record('org-a', movement('m-1', 2)));
      await run(ledger.take('org-a', hold('r-1', 2), undefined));

      const first = await run(ledger.end('org-a', 'r-1', 'released'));
      const second = await run(ledger.end('org-a', 'r-1', 'released'));
      const retaken = await run(
        ledger.take('org-a', hold('r-2', 2), undefined),
      );

      expect([first, second]).toEqual(['transitioned', 'not-held']);
      expect(retaken._tag).toBe('held');
    });

    it('takes a converted hold off the shelf for good', async () => {
      const ledger = await make();
      await run(ledger.record('org-a', movement('m-1', 2)));
      await run(ledger.take('org-a', hold('r-1', 2), undefined));

      const converted = await run(ledger.end('org-a', 'r-1', 'converted'));
      const afterSale = await refusal(
        ledger.take('org-a', hold('r-2', 1), undefined),
      );
      const released = await run(ledger.end('org-a', 'r-1', 'released'));

      expect(converted).toBe('transitioned');
      expect(afterSale).toMatchObject({ requested: 1, available: 0 });
      expect(released).toBe('not-held');
    });

    it('answers ending a hold it never had not-held', async () => {
      const ledger = await make();
      expect(await run(ledger.end('org-a', 'nobody', 'converted'))).toBe(
        'not-held',
      );
    });

    it('restores once per command, and answers the redelivery with the first movement', async () => {
      const ledger = await make();

      const restored = await run(
        ledger.restore('org-a', movement('m-1', 2, 'cancellation'), 'c-1'),
      );
      const again = await run(
        ledger.restore('org-a', movement('m-2', 2, 'cancellation'), 'c-1'),
      );
      const all = await run(ledger.take('org-a', hold('r-1', 2), undefined));
      const more = await refusal(
        ledger.take('org-a', hold('r-2', 1), undefined),
      );

      expect(restored).toMatchObject({
        _tag: 'restored',
        movement: { id: 'm-1' },
      });
      expect(again).toMatchObject({
        _tag: 'replayed',
        movement: { id: 'm-1', quantity: 2 },
      });
      expect(all._tag).toBe('held');
      expect(more).toMatchObject({ available: 0 });
    });

    it('restores every time when no command names the restoration', async () => {
      const ledger = await make();

      await run(ledger.restore('org-a', movement('m-1', 1), undefined));
      const second = await run(
        ledger.restore('org-a', movement('m-2', 1), undefined),
      );
      const both = await run(ledger.take('org-a', hold('r-1', 2), undefined));

      expect(second).toMatchObject({
        _tag: 'restored',
        movement: { id: 'm-2' },
      });
      expect(both._tag).toBe('held');
    });

    it('releases only the holds that expired, in every organization', async () => {
      const ledger = await make();
      const past = new Date(Date.now() - 60_000);
      for (const organizationId of CONTRACT_ORGANIZATIONS) {
        await run(ledger.record(organizationId, movement('m-1', 2)));
        await run(
          ledger.take(organizationId, hold('r-old', 1, past), undefined),
        );
        await run(ledger.take(organizationId, hold('r-new', 1), undefined));
      }

      const released = await run(ledger.releaseExpired());
      const freed = await run(ledger.take('org-b', hold('r-2', 1), undefined));
      const stillHeld = await run(ledger.end('org-a', 'r-new', 'released'));

      expect(released).toEqual({ released: 2, failed: [] });
      expect(freed._tag).toBe('held');
      expect(stillHeld).toBe('transitioned');
    });

    it('reads an item as it stands, and nothing before its first movement', async () => {
      const ledger = await make();
      const before = await run(ledger.item('org-a', 'o-1'));
      await run(ledger.record('org-a', movement('m-1', 5)));
      await run(ledger.take('org-a', hold('r-1', 2), undefined));

      expect(before).toBeUndefined();
      expect(await run(ledger.item('org-a', 'o-1'))).toMatchObject({
        offeringId: 'o-1',
        onHand: 5,
        reserved: 2,
        available: 3,
      });
      expect(await run(ledger.item('org-b', 'o-1'))).toBeUndefined();
    });

    it('keeps what is free equal to what is on hand less what is held, through every move (#555)', async () => {
      const ledger = await make();
      const free = async () => {
        const { available, onHand, reserved } = (await run(
          ledger.item('org-a', 'o-1'),
        )) as StockItem;
        return [available, onHand - reserved];
      };
      const seen: unknown[][] = [];

      // Every kind of move the port makes, interleaved, the invariant read
      // after each: a receipt, holds, a sale, a release, a restoration, an
      // expiry. Each is applied by the ledger, never computed by the caller
      // and written back.
      await run(ledger.record('org-a', movement('m-0', 20)));
      seen.push(await free());
      for (const n of [1, 2, 3, 4, 5, 6]) {
        await run(ledger.take('org-a', hold(`r-${n}`, 2), undefined));
        seen.push(await free());
      }
      await run(ledger.record('org-a', movement('m-1', 5)));
      seen.push(await free());
      await run(ledger.end('org-a', 'r-1', 'converted'));
      seen.push(await free());
      await run(ledger.end('org-a', 'r-2', 'released'));
      seen.push(await free());
      await run(
        ledger.restore('org-a', movement('m-2', 1, 'cancellation'), 'c-1'),
      );
      seen.push(await free());
      await run(
        ledger.take(
          'org-a',
          hold('r-7', 3, new Date(Date.now() - 60_000)),
          undefined,
        ),
      );
      await run(ledger.releaseExpired());
      seen.push(await free());

      for (const [stored, derived] of seen) expect(stored).toBe(derived);
      expect(await run(ledger.item('org-a', 'o-1'))).toMatchObject({
        onHand: 24,
        reserved: 8,
        available: 16,
      });
    });

    it("keeps one organization's shelf out of another's", async () => {
      const ledger = await make();
      await run(ledger.record('org-a', movement('m-1', 5)));

      expect(
        await refusal(ledger.take('org-b', hold('r-1', 1), undefined)),
      ).toMatchObject({ _tag: 'InsufficientStock', available: 0 });
    });
  });
};
