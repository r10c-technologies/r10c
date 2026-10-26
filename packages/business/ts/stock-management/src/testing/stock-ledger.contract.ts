import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { Reservation } from '../entities/reservation';
import { StockMovement } from '../entities/stock-movement';
import type { StockLedger } from '../ports/stock-ledger';

/** Two organizations every subject must keep apart. */
export const CONTRACT_ORGANIZATIONS = ['org-a', 'org-b'] as const;

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

const hold = (
  id: string,
  quantity: number,
  expiresAt = new Date(Date.now() + 60_000),
) =>
  Object.assign(new Reservation('o-1', quantity), {
    id,
    status: 'held',
    expiresAt,
  });

const movement = (id: string, quantity: number, reason = 'receipt') =>
  Object.assign(new StockMovement('o-1', quantity, reason as never), { id });

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
 * one winner. That is the conditional write against a real server, and a run
 * in one process cannot interleave them (ADR 0063).
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
      const refused = await run(
        ledger.take('org-a', hold('r-2', 3), undefined),
      );
      const rest = await run(ledger.take('org-a', hold('r-3', 2), undefined));

      expect(held).toMatchObject({ _tag: 'held', reservation: { id: 'r-1' } });
      expect(refused).toEqual({ _tag: 'insufficient' });
      expect(rest._tag).toBe('held');
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
      const afterSale = await run(
        ledger.take('org-a', hold('r-2', 1), undefined),
      );
      const released = await run(ledger.end('org-a', 'r-1', 'released'));

      expect(converted).toBe('transitioned');
      expect(afterSale).toEqual({ _tag: 'insufficient' });
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
      const more = await run(ledger.take('org-a', hold('r-2', 1), undefined));

      expect(restored).toMatchObject({
        _tag: 'restored',
        movement: { id: 'm-1' },
      });
      expect(again).toMatchObject({
        _tag: 'replayed',
        movement: { id: 'm-1', quantity: 2 },
      });
      expect(all._tag).toBe('held');
      expect(more).toEqual({ _tag: 'insufficient' });
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

      expect(released).toBe(2);
      expect(freed._tag).toBe('held');
      expect(stillHeld).toBe('transitioned');
    });

    it("keeps one organization's shelf out of another's", async () => {
      const ledger = await make();
      await run(ledger.record('org-a', movement('m-1', 5)));

      expect(
        await run(ledger.take('org-b', hold('r-1', 1), undefined)),
      ).toEqual({ _tag: 'insufficient' });
    });
  });
};
