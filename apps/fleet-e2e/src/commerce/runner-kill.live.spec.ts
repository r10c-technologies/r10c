import {
  closeMongo,
  DEMO,
  flowStatus,
  mongo,
  ordersOf,
  PORTS,
  sellable,
  settled,
  sleep,
  startCheckout,
} from '../support/lab';
import { kill, listening, restart } from '../support/processes';

/**
 * A runner SIGKILLed while checkouts are in flight (ADR 0066). The engine's
 * promise is that a flow survives its runner dying: the shards the dead runner
 * held are reassigned, each flow resumes from its journal, and every step that
 * already ran is not run again. So the assertion is not "the checkouts
 * finished" but **"each finished exactly once"**: one order per checkout, one
 * capture, and a stock ledger that moved by exactly what was sold.
 */
const CHECKOUTS = Number(process.env['LIVE_KILL_CHECKOUTS'] ?? 10);
const RUNNER = 'apps/transaction-service/dist/runner.js';

afterAll(async () => {
  // Hand the fleet back whole, whatever the spec did.
  if (!listening(PORTS.runner1)) {
    await restart(RUNNER, PORTS.runner1, { WORKFLOW_REPLICA: '1' });
  }
  await closeMongo();
});

it(`completes ${String(CHECKOUTS)} checkouts exactly once across a killed runner`, async () => {
  const offering = await sellable(DEMO.organizationId, CHECKOUTS);
  const items = (await mongo(`stock_${DEMO.organizationId}`)).collection(
    'stock-item',
  );
  const before = await items.findOne({ offeringId: offering.offeringId });

  const starts = await Promise.all(
    Array.from({ length: CHECKOUTS }, () =>
      startCheckout([
        {
          vendorId: DEMO.organizationId,
          paymentMethod: 'card',
          lines: [
            {
              offeringId: offering.offeringId,
              quantity: 1,
              amount: offering.amount,
            },
          ],
        },
      ]),
    ),
  );
  expect(starts.map(start => start.status)).toEqual(starts.map(() => 202));

  // Mid-flight: the second runner dies without a chance to release anything.
  await sleep(150);
  const killedAt = Date.now();
  await kill(PORTS.runner1, 'SIGKILL');
  // What was still running when it died — a kill after every flow had ended
  // would prove nothing, so the spec says how many it actually caught.
  const atKill = await Promise.all(
    starts.map(start =>
      flowStatus(start.flowId, { capability: start.capability }),
    ),
  );
  const inFlightAtKill = atKill.filter(
    status => status === undefined || status.state === 'running',
  ).length;
  await sleep(5_000);
  await restart(RUNNER, PORTS.runner1, { WORKFLOW_REPLICA: '1' });
  const restartedAt = Date.now();

  const outcomes = await Promise.all(
    starts.map(start =>
      settled(
        start.flowId,
        { capability: start.capability },
        { timeoutMs: 180_000 },
      ),
    ),
  );
  const settledAt = Date.now();

  const groups = starts.map(start => start.flowId);
  const orders = (
    await Promise.all(groups.map(groupId => ordersOf(groupId)))
  ).map(found => found.length);
  const orderIds = (
    await Promise.all(groups.map(groupId => ordersOf(groupId)))
  ).flatMap(found => found.map(order => String(order['id'])));
  const allocations = await (
    await mongo('payment')
  )
    .collection('payment-allocation')
    .find({ orderId: { $in: orderIds } })
    .toArray();
  const after = await items.findOne({ offeringId: offering.offeringId });
  const completed = outcomes.filter(outcome => outcome.state === 'completed');

  console.info(
    'runner kill',
    JSON.stringify({
      inFlightAtKill,
      states: outcomes.map(outcome => outcome.state),
      failures: outcomes
        .filter(outcome => outcome.state !== 'completed')
        .map(outcome => ({ step: outcome.step, failure: outcome.failure })),
      killedToRestartedMs: restartedAt - killedAt,
      restartedToSettledMs: settledAt - restartedAt,
      onHand: [before?.['onHand'], after?.['onHand']],
      reserved: [before?.['reserved'], after?.['reserved']],
    }),
  );

  expect(
    inFlightAtKill,
    'flows still running when the runner died',
  ).toBeGreaterThan(0);
  // Every flow ended, and every one that completed did so once.
  expect(completed).toHaveLength(CHECKOUTS);
  expect(orders).toEqual(groups.map(() => 1));
  expect(new Set(allocations.map(a => a['orderId'])).size).toBe(
    allocations.length,
  );
  expect(allocations).toHaveLength(CHECKOUTS);
  // The ledger moved by exactly what was sold, and no hold was left behind.
  expect(Number(before?.['onHand']) - Number(after?.['onHand'])).toBe(
    CHECKOUTS,
  );
  expect(after?.['reserved']).toBe(before?.['reserved']);
});
