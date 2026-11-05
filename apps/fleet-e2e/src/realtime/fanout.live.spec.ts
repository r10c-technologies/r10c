import {
  closeMongo,
  DEMO,
  PORTS,
  present,
  SECOND,
  sellable,
  settled,
  startCheckout,
  vendorBearer,
} from '../support/lab';
import { sample } from '../support/processes';
import { type Frame, openStream, type Stream } from '../support/stream';

/**
 * Fifty streams through the edge — two organizations' members and anonymous
 * capability holders — and a parallel write burst across both vendors
 * (ADR 0072). The audience filter fails closed; this is where a leak would
 * show, because one tab's frames are another's only under load and only when
 * two organizations are active at once.
 */
const PER_ORG = 20;
const HOLDERS = 10;
const ENTITY_TOPICS = [
  'entity:product-order',
  'entity:stock-item',
  'entity:shipping-order',
];

interface Envelope {
  readonly topics: readonly string[];
  readonly envelope: {
    readonly meta: {
      readonly event?: {
        readonly name: string;
        readonly audience: readonly { kind: string; id: string }[];
        readonly aggregate?: { type: string; id: string };
      };
    };
  };
}

const events = (stream: Stream) =>
  stream.frames
    .filter((frame: Frame) => frame.data !== undefined)
    .map(frame => JSON.parse(frame.data ?? '{}') as Envelope)
    .filter(body => body.envelope?.meta?.event !== undefined);

const streams: Stream[] = [];

afterAll(async () => {
  for (const stream of streams) stream.close();
  await closeMongo();
});

it(`keeps ${String(PER_ORG * 2 + HOLDERS)} streams to their own audiences under a write burst`, async () => {
  const before = sample(PORTS.realtime);
  const members = {
    [DEMO.organizationId]: [] as Stream[],
    [SECOND.organizationId]: [] as Stream[],
  };
  for (const vendor of [DEMO, SECOND]) {
    const bearer = await vendorBearer(vendor.organizationId);
    const opened = await Promise.all(
      Array.from({ length: PER_ORG }, (_, n) =>
        openStream(`${vendor.slug}-${String(n)}`, {
          bearer,
          topics: ENTITY_TOPICS,
        }),
      ),
    );
    members[vendor.organizationId] = opened;
    streams.push(...opened);
  }
  expect(streams.every(stream => stream.status === 200)).toBe(true);
  const opened = sample(PORTS.realtime);

  // The burst: checkouts on both vendors at once, each with its own holder.
  const demoOffering = await sellable(DEMO.organizationId, HOLDERS);
  const secondOffering = await sellable(SECOND.organizationId, HOLDERS);
  const checkouts = await Promise.all(
    Array.from({ length: HOLDERS }, (_, n) => {
      const vendor = n % 2 === 0 ? DEMO : SECOND;
      const offering = n % 2 === 0 ? demoOffering : secondOffering;
      return startCheckout([
        {
          vendorId: vendor.organizationId,
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
    }),
  );
  const holders = await Promise.all(
    checkouts.map((checkout, n) =>
      openStream(`holder-${String(n)}`, {
        capabilities: [checkout.capability.nonce],
        topics: [`flow:${checkout.flowId}`],
      }),
    ),
  );
  streams.push(...holders);
  await Promise.all(
    checkouts.map(checkout =>
      settled(checkout.flowId, { capability: checkout.capability }),
    ),
  );
  // Let the last announcements reach every replica's broadcast queue.
  await Promise.all(streams.map(stream => stream.until(() => false, 3_000)));
  const after = sample(PORTS.realtime);

  // Members: every frame is addressed to their own organization, and each
  // heard their own organization's burst.
  for (const [organizationId, own] of Object.entries(members)) {
    for (const stream of own) {
      const heard = events(stream);
      const foreign = heard.filter(
        body =>
          !(body.envelope.meta.event?.audience ?? []).some(
            entry =>
              entry.kind === 'organization' && entry.id === organizationId,
          ),
      );
      expect(foreign, `${stream.label} heard another audience`).toEqual([]);
      expect(
        heard.length,
        `${stream.label} heard its own burst`,
      ).toBeGreaterThan(0);
    }
  }
  // Holders: only their own flow, and nothing addressed to an organization.
  holders.forEach((stream, n) => {
    const own = present(checkouts[n], 'a checkout per holder').flowId;
    const foreign = events(stream).filter(
      body =>
        !(body.envelope.meta.event?.audience ?? []).some(
          entry => entry.kind === 'flow' && entry.id === own,
        ) || body.topics.some(topic => topic !== `flow:${own}`),
    );
    expect(foreign, `${stream.label} heard another flow`).toEqual([]);
  });
  // Nothing was closed under the load.
  expect(streams.filter(stream => stream.frames.length === 0)).toEqual([]);

  console.info(
    'fanout',
    JSON.stringify({
      streams: streams.length,
      framesPerMember: Object.fromEntries(
        Object.entries(members).map(([org, own]) => [
          org,
          own.map(stream => events(stream).length),
        ]),
      ),
      holdersHeardTheirFlow: holders.filter(stream => events(stream).length > 0)
        .length,
      realtime: { before, opened, after },
    }),
  );
});
