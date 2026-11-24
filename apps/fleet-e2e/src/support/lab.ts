import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { signAccessToken } from '@entifix/jwt';
import {
  AUTH_TOKEN_AUDIENCE,
  AUTH_TOKEN_ISSUER,
} from '@r10c/business-ts-authn';
import {
  lineTotal,
  saleTermsOf,
  stockSourceOf,
} from '@r10c/business-ts-sales-vocabulary';
import { configSourceFor, SEEDED_VENDORS } from '@r10c/utils-ts-fleet';
import { type Db, MongoClient } from 'mongodb';

/**
 * The live fleet, as the pass reaches it: where each process answers, the
 * credentials it accepts, and read access to the stores whose invariants the
 * specs assert.
 *
 * ⚠️ **Every URL defaults to the lab's canonical port**, unlike a single
 * service's live suite, which throws without its URL. That rule exists so a
 * suite cannot skip itself into a green report; a default port cannot do that
 * — nothing listening there fails the first request. And this suite talks to
 * nine processes, which would be nine variables to type for the one fleet
 * there is.
 */
const url = (variable: string, port: number) =>
  (process.env[variable] ?? `http://localhost:${String(port)}`).replace(
    /\/+$/,
    '',
  );

export const FLEET = {
  marketplaceAdmin: url('MARKETPLACE_ADMIN_SERVICE_URL', 3101),
  transaction: url('TRANSACTION_SERVICE_URL', 3103),
  order: url('ORDER_SERVICE_URL', 3105),
  payment: url('PAYMENT_SERVICE_URL', 3106),
  settlement: url('SETTLEMENT_SERVICE_URL', 3107),
  stock: url('STOCK_SERVICE_URL', 3108),
  sales: url('SALES_SERVICE_URL', 3109),
  fulfilment: url('FULFILMENT_SERVICE_URL', 3110),
  realtime: url('REALTIME_SERVICE_URL', 3191),
  /** The edge (ADR 0072): what a browser opens a stream through. */
  edge: url('EDGE_URL', 3001),
} as const;

/** The ports the pass kills and restarts processes by. */
export const PORTS = {
  transaction: 3103,
  runner0: 34103,
  runner1: 35103,
  realtime: 3191,
} as const;

export const MONGO_URI =
  process.env['MONGO_URI'] ??
  'mongodb://admin:password@127.0.0.1:30017/?directConnection=true';

/**
 * The sample stores (#676): hardware takes payment links and sells by the
 * metre and the hundred; phones are small-taxpayer; shoemaking sells by the
 * yard under the simplified regime.
 */
export const [HARDWARE, PHONE, SHOEMAKING] = SEEDED_VENDORS;

/**
 * A seeded product's offering id, by its key in the store's catalog — the id
 * the catalog seed writes for its position, under the store's prefix.
 */
export const offeringIdOf = (
  vendor: (typeof SEEDED_VENDORS)[number],
  key: string,
): string => {
  const index = vendor.products.findIndex(product => product.key === key);
  if (index < 0) throw new Error(`${vendor.slug} seeds no product '${key}'`);
  return `${vendor.idPrefix}product-offering-${String(index + 1)}`;
};

/** Each store's offering ids whose seeded status is `status`. */
export const offeringIdsWith = (
  vendor: (typeof SEEDED_VENDORS)[number],
  status: string,
): string[] =>
  vendor.products.flatMap((product, index) =>
    product.status === status
      ? [`${vendor.idPrefix}product-offering-${String(index + 1)}`]
      : [],
  );

/** Each seeded store's member: the session a vendor's verbs run under. */
export const MEMBERS = {
  [HARDWARE.organizationId]: { userId: 'user-2', partyId: 'party-user-2' },
  [PHONE.organizationId]: { userId: 'user-5', partyId: 'party-user-5' },
  [SHOEMAKING.organizationId]: { userId: 'user-6', partyId: 'party-user-6' },
} as const;

export const sleep = (ms: number) =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

/** Polls `read` until `done` holds, or fails with what it last saw. */
export const eventually = async <A>(
  read: () => Promise<A>,
  done: (value: A) => boolean,
  { timeoutMs = 60_000, everyMs = 250, what = 'condition' } = {},
): Promise<A> => {
  const deadline = Date.now() + timeoutMs;
  let last: A = await read();
  while (!done(last)) {
    if (Date.now() > deadline) {
      throw new Error(
        `timed out waiting for ${what}; last saw ${JSON.stringify(last)}`,
      );
    }
    await sleep(everyMs);
    last = await read();
  }
  return last;
};

// ---------------------------------------------------------------------------
// Configuration: the deployment's own key and secrets, read where the fleet
// reads them.

type Rows = Record<string, readonly { key: string; value: string }[]>;
const configCache = new Map<string, Promise<Rows>>();

/** A service's configuration rows, fetched from config-service once per run. */
export const configOf = (service: string): Promise<Rows> => {
  let rows = configCache.get(service);
  if (rows === undefined) {
    const source = configSourceFor(service);
    rows = fetch(source.url, { headers: source.headers }).then(async res => {
      if (!res.ok) {
        throw new Error(
          `config-service answered ${String(res.status)} for ${service}`,
        );
      }
      return (await res.json()) as Rows;
    });
    configCache.set(service, rows);
  }
  return rows;
};

export const configValue = async (
  service: string,
  group: string,
  key: string,
): Promise<string> => {
  const value = (await configOf(service))[group]?.find(
    row => row.key === key,
  )?.value;
  if (value === undefined) {
    throw new Error(`${service} has no ${group}.${key} row`);
  }
  return value;
};

// ---------------------------------------------------------------------------
// Credentials.

/**
 * A signed access token, with the deployment's own key — the one auth-service
 * mints with, read from its configuration rather than copied into the suite.
 * The verifiers cannot tell it from a sign-in's: this skips Zitadel and nothing
 * else.
 */
export const tokenFor = async (
  claims: {
    readonly userId: string;
    readonly roles: readonly string[];
    readonly organizationId?: string;
    readonly partyId?: string;
    readonly partyRole?: string;
  },
  ttlSeconds = 900,
): Promise<string> =>
  signAccessToken(
    {
      userId: claims.userId,
      subject: claims.userId,
      sessionId: `live-${randomUUID()}`,
      roles: claims.roles,
      ...(claims.organizationId === undefined
        ? {}
        : { activeOrganizationId: claims.organizationId }),
      ...(claims.partyId === undefined ? {} : { partyId: claims.partyId }),
      ...(claims.partyRole === undefined
        ? {}
        : { partyRole: claims.partyRole }),
    },
    {
      privateKeyPem: await configValue('auth-service', 'jwt', 'privateKey'),
      publicKeyPem: await configValue('auth-service', 'jwt', 'publicKey'),
      keyId: await configValue('auth-service', 'jwt', 'keyId'),
      issuer: AUTH_TOKEN_ISSUER,
      audience: AUTH_TOKEN_AUDIENCE,
    },
    ttlSeconds,
  );

/** A vendor member's bearer, scoped to their own organization. */
export const vendorBearer = async (organizationId: string, ttlSeconds = 900) =>
  `Bearer ${await tokenFor(
    {
      ...MEMBERS[organizationId as keyof typeof MEMBERS],
      roles: ['admin'],
      organizationId,
      partyRole: 'vendor',
    },
    ttlSeconds,
  )}`;

/**
 * A flow crossing into `service`, with that service's own inbound token and an
 * `Idempotency-Key` — what a coordinator or the storefront presents.
 */
export const crossingHeaders = async (
  service: string,
  key: string = randomUUID(),
  token?: string,
) => ({
  'content-type': 'application/json',
  'x-crossing-token': token ?? (await configValue(service, 'service', 'token')),
  'idempotency-key': `"${key}"`,
});

// ---------------------------------------------------------------------------
// Stores.

let client: MongoClient | undefined;

export const mongo = async (database: string): Promise<Db> => {
  if (client === undefined) {
    client = new MongoClient(MONGO_URI);
    await client.connect();
  }
  return client.db(database);
};

export const closeMongo = async () => {
  await client?.close();
  client = undefined;
};

/** `value`, or a failure naming what the lab was expected to hold. */
export const present = <A>(value: A | undefined, what: string): A => {
  if (value === undefined) throw new Error(`expected ${what}`);
  return value;
};

/**
 * The offering a vendor can best sell: published in GTQ, with the most stock
 * free. A lab drained by earlier runs fails here, naming the fix, rather than
 * as a checkout refused for stock.
 */
export const sellable = async (organizationId: string, atLeast = 1) =>
  present(
    (await sellableOfferings(organizationId, atLeast))[0],
    `a published GTQ offering of ${organizationId} with ${String(atLeast)} free — reset the lab (pnpm run back-office:dev:reset)`,
  );

const sellableOfferings = async (organizationId: string, atLeast: number) => {
  const published = await (
    await mongo('marketplace')
  )
    .collection('published-offering')
    // Sold by the piece, priced for one: what a spec buying `quantity: 1`
    // means. The seed's measured offerings are read by `measuredOffering`.
    .find({
      vendorId: organizationId,
      currency: 'GTQ',
      saleUnit: 'UN',
      pricePer: 1,
    })
    .toArray();
  const items = await (
    await mongo(`stock_${organizationId}`)
  )
    .collection('stock-item')
    .find({})
    .toArray();
  const available = new Map(
    items.map(item => [
      String(item['offeringId']),
      Number(item['onHand']) - Number(item['reserved']),
    ]),
  );
  return published
    .map(offering => ({
      offeringId: String(offering['offeringId']),
      name: String(offering['name']),
      amount: Number(offering['amount']),
      available: available.get(String(offering['offeringId'])) ?? 0,
    }))
    .filter(offering => offering.available >= atLeast)
    .sort((a, b) => b.available - a.available);
};

// ---------------------------------------------------------------------------
// Flows.

export interface Capability {
  readonly nonce: string;
  readonly digest: string;
}

/** A buyer's capability, minted the way the storefront mints one. */
export const capability = (): Capability => {
  const nonce = randomBytes(32).toString('hex');
  return { nonce, digest: createHash('sha256').update(nonce).digest('hex') };
};

export interface Segment {
  readonly vendorId: string;
  readonly paymentMethod: 'card' | 'cod' | 'link';
  readonly lines: readonly {
    readonly offeringId: string;
    readonly quantity: number;
    readonly amount: number;
    /** The name as sold; the offering's id stands in when a spec names none. */
    readonly name?: string;
  }[];
}

export interface Started {
  readonly status: number;
  readonly flowId: string;
  readonly capability: Capability;
  /** The body a refused start answered, so a failure names its reason. */
  readonly problem?: unknown;
}

/**
 * The specification version an offering is on sale under, and the terms its
 * price is quoted on, read off the projection as the storefront prices a line
 * (ADR 0079 §3, ADR 0082). An offering without terms is no published price.
 */
const pinOf = async (offeringId: string) => {
  const published = await (
    await mongo('marketplace')
  )
    .collection('published-offering')
    .findOne({ offeringId });
  const terms = saleTermsOf(published ?? undefined);
  if (terms === undefined)
    throw new Error(`${offeringId} is published with no sale terms`);
  return {
    specificationId: String(published?.['specificationId'] ?? ''),
    specificationVersion: Number(published?.['specificationVersion'] ?? 0),
    saleUnit: terms.saleUnit,
    pricePer: terms.pricePer,
    // A presentation states its base as the storefront does (ADR 0082 §7).
    ...(published === null ? undefined : stockSourceOf(published)),
  };
};

/** `POST /api/flow/checkout`, as the storefront starts one. */
export const startCheckout = async (
  segments: readonly Segment[],
): Promise<Started> => {
  const cap = capability();
  const pins = new Map(
    await Promise.all(
      segments
        .flatMap(segment => segment.lines)
        .map(
          async line =>
            [line.offeringId, await pinOf(line.offeringId)] as const,
        ),
    ),
  );
  // What the coordinator will state again, by `lineTotal` (ADR 0082 §6).
  const total = segments
    .flatMap(segment => segment.lines)
    .reduce((sum, line) => {
      const pin = pins.get(line.offeringId);
      return pin === undefined
        ? sum
        : sum +
            lineTotal({
              amount: line.amount,
              quantity: line.quantity,
              saleUnit: pin.saleUnit,
              pricePer: pin.pricePer,
            });
    }, 0);
  const res = await fetch(`${FLEET.transaction}/api/flow/checkout`, {
    method: 'POST',
    // The coordinator's inbound token — the one the storefront holds.
    headers: await crossingHeaders('transaction-service'),
    body: JSON.stringify({
      channel: { type: 'storefront' },
      vendors: segments.map(segment => ({
        ...segment,
        lines: segment.lines.map(line => ({
          ...line,
          // A line names what was sold, and the version it was sold under
          // (#582, ADR 0079 §3).
          name: line.name ?? line.offeringId,
          ...pins.get(line.offeringId),
          currency: 'GTQ',
        })),
      })),
      totals: [{ currency: 'GTQ', amount: total }],
      capabilityDigest: cap.digest,
      // One nonce for both of the receipt's capabilities: hearing the flow,
      // and the buyer's own cancellation or withdrawal (ADR 0058, ADR 0081 §4).
      cancelDigest: cap.digest,
      // A storefront checkout names where its parcels go (ADR 0076 §3); the
      // receipt mail lands in Mailpit.
      contact: {
        name: 'Ana López',
        phone: '+50255551234',
        email: 'ana@correo.com',
        destination: {
          departamento: '01',
          municipio: '0108',
          addressLine: '5a avenida 12-34',
        },
      },
    }),
  });
  const body = (await res.json()) as { data?: { flowId?: string } };
  return {
    status: res.status,
    flowId: body.data?.flowId ?? '',
    capability: cap,
    ...(res.ok ? {} : { problem: body }),
  };
};

export interface FlowStatus {
  readonly flowId: string;
  readonly state: string;
  readonly step?: string;
  readonly committed?: boolean;
  readonly failure?: { readonly code: string };
}

/** The flow's projected status, as a capability holder reads it; `undefined` while `404`. */
export const flowStatus = async (
  flowId: string,
  auth: { capability?: Capability; bearer?: string },
): Promise<FlowStatus | undefined> => {
  const query =
    auth.capability === undefined ? '' : `?capability=${auth.capability.nonce}`;
  const res = await fetch(
    `${FLEET.realtime}/api/realtime/flow/${flowId}${query}`,
    {
      headers: auth.bearer === undefined ? {} : { authorization: auth.bearer },
    },
  );
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`flow status answered ${String(res.status)}`);
  return ((await res.json()) as { data: FlowStatus }).data;
};

const SETTLED = new Set([
  'completed',
  'compensated',
  'failed',
  'interrupted',
  'stranded',
]);

/** Waits for a flow to end, or to park past its commit point. */
export const settled = (
  flowId: string,
  auth: { capability?: Capability; bearer?: string },
  { timeoutMs = 90_000, orWaiting = false } = {},
) =>
  eventually(
    () => flowStatus(flowId, auth),
    status =>
      status !== undefined &&
      (SETTLED.has(status.state) ||
        (orWaiting && status.state === 'waiting' && status.committed === true)),
    { timeoutMs, what: `flow ${flowId} to settle` },
  ) as Promise<FlowStatus>;

/** The vendor orders a checkout wrote, one per segment, keyed by vendor. */
export const ordersOf = async (groupId: string) =>
  (await mongo('order'))
    .collection('product-order')
    .find({ groupId })
    .toArray();

/**
 * A vendor records the guide a parcel leaves with (ADR 0081 §11), under the
 * lab's `other` courier — a dispatch is refused `guideMissing` until one is
 * recorded.
 */
export const recordGuide = (
  shippingOrderId: string,
  bearer: string,
  trackingNumber = `G-${shippingOrderId.slice(0, 8)}`,
) =>
  fetch(
    `${FLEET.fulfilment}/api/shipping-order/${shippingOrderId}/record-guide`,
    {
      method: 'POST',
      headers: {
        authorization: bearer,
        'content-type': 'application/json',
        // An RFC 9651 String: the verb is idempotent at the edge.
        'idempotency-key': `"${randomBytes(16).toString('hex')}"`,
      },
      body: JSON.stringify({
        courierKey: 'other',
        courierName: 'Mensajería del barrio',
        trackingNumber,
      }),
    },
  );
