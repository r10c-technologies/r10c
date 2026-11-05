import {
  closeMongo,
  DEMO,
  eventually,
  FLEET,
  PORTS,
  present,
  SECOND,
  sellable,
  sleep,
  startCheckout,
  vendorBearer,
} from '../support/lab';
import { kill, listening, restart } from '../support/processes';
import { openStream, type Stream } from '../support/stream';

/**
 * realtime-service stopped under thirty open streams, the way a rolling deploy
 * stops it (ADR 0072): SIGTERM, a drain, a restart. What a browser needs from
 * that is three things, and each is asserted. Every stream is told when to
 * come back, and not all at the same moment — the `retry:` is drawn from the
 * dialled range so the reconnects spread rather than land as one spike. Every
 * reconnect is admitted: a `401` on an open `EventSource` kills it for good.
 * And a write that settled while the stream was down is caught up from
 * flow-status rather than lost.
 */
const STREAMS = 30;
const REALTIME = 'apps/realtime-service/dist/main.js';
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 5_000;

const streams: Stream[] = [];

afterAll(async () => {
  for (const stream of streams) stream.close();
  if (!listening(PORTS.realtime)) await restart(REALTIME, PORTS.realtime);
  await closeMongo();
});

it(`drains ${String(STREAMS)} streams with jittered retries, and every one comes back`, async () => {
  const bearers = {
    [DEMO.organizationId]: await vendorBearer(DEMO.organizationId),
    [SECOND.organizationId]: await vendorBearer(SECOND.organizationId),
  };
  const orgOf = (n: number) =>
    n % 2 === 0 ? DEMO.organizationId : SECOND.organizationId;
  const topics = ['entity:product-order', 'entity:stock-item'];
  const opened = await Promise.all(
    Array.from({ length: STREAMS }, (_, n) =>
      openStream(`s-${String(n)}`, { bearer: bearers[orgOf(n)], topics }),
    ),
  );
  streams.push(...opened);
  expect(opened.every(stream => stream.status === 200)).toBe(true);
  await Promise.all(
    opened.map(stream => stream.until(frames => frames.length > 0)),
  );

  const stoppedAt = Date.now();
  await kill(PORTS.realtime, 'SIGTERM');
  const portClosedAt = Date.now();
  const endedAt = await Promise.all(
    opened.map(stream => stream.ended.then(() => Date.now())),
  );

  // What the drain told each stream: the last `retry:` it sent before closing.
  const retries = opened.map(
    stream =>
      stream.frames
        .filter(frame => frame.retry !== undefined && frame.at >= stoppedAt)
        .at(-1)?.retry,
  );

  // A write that settles while nobody can hear it.
  const offering = await sellable(DEMO.organizationId);
  const missed = await startCheckout([
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
  ]);
  const downFor = Date.now() - stoppedAt;
  await restart(REALTIME, PORTS.realtime);
  const backAt = Date.now();

  // Each stream comes back after its own retry, as an EventSource would.
  const reopened = await Promise.all(
    opened.map(async (stream, n) => {
      const wait = retries[n] ?? RETRY_MAX_MS;
      await sleep(Math.max(0, stoppedAt + wait - Date.now()));
      const again = await openStream(`${stream.label}-again`, {
        bearer: bearers[orgOf(n)],
        topics,
      });
      streams.push(again);
      return again;
    }),
  );

  // The settled write, caught up rather than lost.
  const caughtUp = await eventually(
    async () => {
      const res = await fetch(
        `${FLEET.edge}/api/realtime/flow?ids=${missed.flowId}`,
        { headers: { authorization: bearers[DEMO.organizationId] } },
      );
      if (res.status !== 200) return undefined;
      const { data } = (await res.json()) as {
        data: { state: string }[] | { items?: { state: string }[] };
      };
      return Array.isArray(data) ? data : (data.items ?? []);
    },
    flows => flows?.[0]?.state === 'completed',
    { timeoutMs: 60_000, what: 'the missed flow to be caught up' },
  );

  console.info(
    'restart',
    JSON.stringify({
      retries,
      portClosedAfterMs: portClosedAt - stoppedAt,
      streamsEndedAfterMs: [
        Math.min(...endedAt) - stoppedAt,
        Math.max(...endedAt) - stoppedAt,
      ],
      framesAfterStop: present(opened[0], 'a stream')
        .frames.filter(frame => frame.at >= stoppedAt)
        .map(frame => ({ ...frame, data: frame.data?.slice(0, 80) })),
      distinctRetries: new Set(retries).size,
      realtimeDownForMs: backAt - stoppedAt,
      checkoutStartedAfterMs: downFor,
      reopened: reopened.map(stream => stream.status),
      caughtUp: caughtUp?.[0],
    }),
  );

  // Told when to come back, within the dial, and not all at once.
  expect(retries.every(retry => retry !== undefined)).toBe(true);
  expect(
    retries.every(
      retry =>
        retry !== undefined && retry >= RETRY_MIN_MS && retry <= RETRY_MAX_MS,
    ),
  ).toBe(true);
  expect(new Set(retries).size).toBeGreaterThan(1);
  // Every one admitted again — none closed for good.
  expect(reopened.map(stream => stream.status)).toEqual(
    reopened.map(() => 200),
  );
});
