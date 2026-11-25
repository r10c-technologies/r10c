import { randomUUID } from 'node:crypto';

import { startBroker, stopBroker } from '../support/broker';
import {
  closeMongo,
  eventually,
  FLEET,
  HARDWARE,
  mongo,
  sleep,
  vendorBearer,
} from '../support/lab';

/**
 * A broker outage delays a publication and loses none (entifix #330, #704).
 *
 * Measured before the fix, on the lab cluster: with RabbitMQ stopped for about
 * two minutes, the outbox relay spent all five attempts on "unreachable" and
 * quarantined every event committed meanwhile — a `catalog.published` that
 * never reached the storefront, `shipping-order.delivered` reports that never
 * reached the delivery flows. The relay now holds an entry while the bus is
 * down and spends no attempt on it, so this stops the broker for longer than
 * the old window (five sweeps of 15 s), writes a publication into it, and
 * requires the storefront to show it once the broker is back.
 */
const OUTAGE_MS = 100_000;

let stopped = false;

afterAll(async () => {
  if (stopped) startBroker();
  await closeMongo();
});

it('publishes what was written while the broker was down, once it is back', async () => {
  const name = `Durante la caída ${randomUUID().slice(0, 8)}`;

  stopBroker();
  stopped = true;
  const answered = await fetch(
    `${FLEET.marketplaceAdmin}/api/catalog-import/import`,
    {
      method: 'POST',
      headers: {
        authorization: await vendorBearer(HARDWARE.organizationId),
        'content-type': 'application/json',
        'idempotency-key': `"${randomUUID()}"`,
      },
      body: JSON.stringify({
        fileName: 'caida.csv',
        mode: 'publish',
        rows: [
          {
            rowNumber: 2,
            name,
            amount: 100,
            currency: 'GTQ',
            pricePer: 1,
            saleUnit: 'UN',
            quantityStep: 1,
            quantityMinimum: 1,
          },
        ],
      }),
    },
  );
  // The write is the outbox's, not the broker's: it commits regardless.
  expect(answered.status).toBe(200);

  await sleep(OUTAGE_MS);
  startBroker();
  stopped = false;

  const outbox = (await mongo(`tenant_${HARDWARE.organizationId}`)).collection(
    'outbox',
  );
  const entry = await outbox.findOne({ 'event.data.name': name });
  expect(entry?.['quarantined']).not.toBe(true);

  await eventually(
    async () =>
      (await mongo('marketplace'))
        .collection('published-offering')
        .countDocuments({ name }),
    count => count === 1,
    { timeoutMs: 120_000, what: `${name} on the storefront` },
  );
  expect((await outbox.findOne({ 'event.data.name': name }))?.['sent']).toBe(
    true,
  );
});
