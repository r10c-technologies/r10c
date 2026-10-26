import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { Agreement } from '../entities/agreement';
import type {
  SaleHalf,
  SaleJoin,
  SettlementRunStore,
} from '../ports/settlement-ports';

/** The two ports one settlement store serves, over one ledger. */
export interface SettlementPorts {
  readonly join: SaleJoin;
  readonly runs: SettlementRunStore;
}

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

const anAgreement = (vendorId: string, basisPoints: number, from: string) =>
  Object.assign(new Agreement(vendorId, basisPoints), {
    id: `${vendorId}-${from}`,
    effectiveFrom: new Date(from),
  });

/** The agreements every subject is made with. */
export const CONTRACT_AGREEMENTS: readonly Agreement[] = [
  anAgreement('v-1', 1000, '2026-01-01T00:00:00.000Z'),
  anAgreement('v-1', 1200, '2026-06-01T00:00:00.000Z'),
  anAgreement('v-2', 500, '2026-01-01T00:00:00.000Z'),
];

const sale: SaleHalf = {
  commissions: [
    { vendorId: 'v-1', saleAmount: 100, commissionAmount: 12, currency: 'GTQ' },
    { vendorId: 'v-2', saleAmount: 50, commissionAmount: 3, currency: 'GTQ' },
  ],
  unpriced: [],
};
const paid: SaleHalf = { decidedAt: '2026-03-01T10:00:00.000Z' };
const cancelled: SaleHalf = { cancelledAt: '2026-03-01T11:00:00.000Z' };
const refunded: SaleHalf = { refundedAt: '2026-03-01T11:05:00.000Z' };

/**
 * What every settlement store must guarantee to the fold and the run, through
 * {@link SaleJoin} and {@link SettlementRunStore} alone:
 * - a sale is folded once, when its placement and its payment have both
 *   arrived, in either order;
 * - it is reversed once, when its cancellation and its refund have both
 *   arrived after it — or in the same write, if they came first;
 * - an event is folded once;
 * - a run claims every unsettled line once.
 *
 * `make` returns a fresh store holding {@link CONTRACT_AGREEMENTS}.
 *
 * Deliberately not asserted: two folds racing on one join record. That is the
 * conditional upsert against a real server (ADR 0063).
 */
export const describeSettlementStoreContract = (
  name: string,
  make: () => SettlementPorts | Promise<SettlementPorts>,
) => {
  describe(`${name} honours the settlement store contract`, () => {
    let next = 0;
    const contribute = (
      { join }: SettlementPorts,
      orderId: string,
      half: SaleHalf,
      eventId = `e-${(next += 1)}`,
    ) =>
      run(join.contribute({ consumer: 'contract', eventId }, orderId, half));

    it("reads each vendor's latest agreement, and nobody else's", async () => {
      const { join } = await make();

      const agreements = await run(join.agreementsFor(['v-1', 'v-3']));

      expect(Array.from(agreements.keys())).toEqual(['v-1']);
      expect(agreements.get('v-1')?.commissionBasisPoints).toBe(1200);
    });

    it('folds a sale once both halves arrived, in either order', async () => {
      const ports = await make();

      const placedFirst = await contribute(ports, 'ord-1', sale);
      const thenPaid = await contribute(ports, 'ord-1', paid);
      const paidFirst = await contribute(ports, 'ord-2', paid);
      const thenPlaced = await contribute(ports, 'ord-2', sale);

      expect(placedFirst).toEqual({ kind: 'waiting' });
      expect(thenPaid).toEqual({ kind: 'written', folded: 2, reversed: 0 });
      expect(paidFirst).toEqual({ kind: 'waiting' });
      expect(thenPlaced).toEqual({ kind: 'written', folded: 2, reversed: 0 });
    });

    it('folds an event once, and a sale once however many events repeat it', async () => {
      const ports = await make();
      await contribute(ports, 'ord-1', sale, 'placed-1');

      const first = await contribute(ports, 'ord-1', paid, 'paid-1');
      const redelivered = await contribute(ports, 'ord-1', paid, 'paid-1');
      const another = await contribute(ports, 'ord-1', paid, 'paid-2');

      expect(first.kind).toBe('written');
      expect(redelivered).toEqual({ kind: 'duplicate' });
      expect(another).toEqual({ kind: 'waiting' });
    });

    it('reverses a folded sale once its cancellation and refund both arrived', async () => {
      const ports = await make();
      await contribute(ports, 'ord-1', sale);
      await contribute(ports, 'ord-1', paid);

      const cancelledOnly = await contribute(ports, 'ord-1', cancelled);
      const reversed = await contribute(ports, 'ord-1', refunded);
      const again = await contribute(ports, 'ord-1', refunded);

      expect(cancelledOnly).toEqual({ kind: 'waiting' });
      expect(reversed).toEqual({ kind: 'written', folded: 0, reversed: 2 });
      expect(again).toEqual({ kind: 'waiting' });
    });

    it('writes a sale and its mirror together when the reversal arrived first', async () => {
      const ports = await make();
      await contribute(ports, 'ord-1', cancelled);
      await contribute(ports, 'ord-1', refunded);
      await contribute(ports, 'ord-1', paid);

      const placed = await contribute(ports, 'ord-1', sale);

      expect(placed).toEqual({ kind: 'written', folded: 2, reversed: 2 });
    });

    it('settles every unsettled line once, and is idle with nothing to settle', async () => {
      const ports = await make();

      const empty = await run(ports.runs.settleOnce());
      await contribute(ports, 'ord-1', sale);
      await contribute(ports, 'ord-1', paid);
      const settled = await run(ports.runs.settleOnce());
      const afterwards = await run(ports.runs.settleOnce());

      expect(empty).toEqual({ kind: 'idle' });
      expect(settled).toMatchObject({
        kind: 'calculated',
        payouts: 2,
        entries: 2,
        periodStart: '2026-03-01T10:00:00.000Z',
      });
      expect(afterwards).toEqual({ kind: 'idle' });
    });

    it('settles a reversal written after a run in the next run', async () => {
      const ports = await make();
      await contribute(ports, 'ord-1', sale);
      await contribute(ports, 'ord-1', paid);
      await run(ports.runs.settleOnce());
      await contribute(ports, 'ord-1', cancelled);
      await contribute(ports, 'ord-1', refunded);

      expect(await run(ports.runs.settleOnce())).toMatchObject({
        kind: 'calculated',
        payouts: 2,
        entries: 2,
        periodStart: '2026-03-01T11:05:00.000Z',
      });
    });
  });
};
