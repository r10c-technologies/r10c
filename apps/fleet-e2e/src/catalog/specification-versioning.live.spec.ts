import { randomUUID } from 'node:crypto';

import {
  closeMongo,
  FLEET,
  HARDWARE,
  mongo,
  ordersOf,
  sellable,
  settled,
  startCheckout,
  vendorBearer,
} from '../support/lab';

/**
 * A released specification is never edited, an offering pins its version, and
 * an order line is a copy (ADR 0079 §1–§3, #664) — on the running fleet, where
 * the conditional writes meet a real replica set and two requests really race.
 */
afterAll(closeMongo);

const KEY = 'product-specification';

const call = async (
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
) => {
  const res = await fetch(`${FLEET.marketplaceAdmin}/api/${path}`, {
    method,
    headers: {
      authorization: await vendorBearer(HARDWARE.organizationId),
      'content-type': 'application/json',
      'idempotency-key': `"${randomUUID()}"`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text === '' ? {} : JSON.parse(text)) as Record<string, any>,
  };
};

const create = (name: string) =>
  call('POST', KEY, { meta: { type: 'entity', entity: KEY }, data: { name } });

const verb = (id: string, name: string) =>
  call('POST', `${KEY}/${id}/${name}`, {});

it('refuses a PUT on a released version, and edits one in design', async () => {
  const seeded = (await call('GET', `${KEY}?pageSize=1`)).body['data'].items[0];
  expect(seeded.lifecycleStatus).toBe('active');

  const refused = await call('PUT', `${KEY}/${seeded.id}`, {
    meta: { type: 'entity', entity: KEY },
    data: { ...seeded, name: 'Renamed after release' },
  });
  expect(refused.status).toBe(409);
  expect(refused.body['code']).toBe('specificationReleased');

  // A product created through the API starts in design, at revision 1, and
  // its first edit names that revision.
  const draft = (await create('A draft to edit')).body['data'];
  expect(draft).toMatchObject({
    version: 1,
    lifecycleStatus: 'in-design',
    revision: 1,
  });
  const edited = await call('PUT', `${KEY}/${draft.id}`, {
    meta: { type: 'entity', entity: KEY },
    data: { ...draft, name: 'An edited draft' },
  });
  expect(edited.status).toBe(200);
});

it('revises, releases and retires, one active version per series', async () => {
  const created = (await create('A versioned product')).body['data'];
  expect((await verb(created.id, 'release')).status).toBe(200);

  const next = (await verb(created.id, 'revise')).body['data'];
  expect(next).toMatchObject({ version: 2, lifecycleStatus: 'in-design' });
  const released = (await verb(next.id, 'release')).body['data'];
  expect(released.contentHash).toMatch(/^[0-9a-f]{64}$/);

  const series = await (
    await mongo(`tenant_${HARDWARE.organizationId}`)
  )
    .collection(KEY)
    .find({ specKey: created.specKey })
    .sort({ version: 1 })
    .toArray();
  expect(series.map(one => one['lifecycleStatus'])).toEqual([
    'retired',
    'active',
  ]);
});

it('lets exactly one of two racing releases land, and one of two revises', async () => {
  const draft = (await create('A raced product')).body['data'];

  const releases = await Promise.all([
    verb(draft.id, 'release'),
    verb(draft.id, 'release'),
  ]);
  expect(releases.map(one => one.status).sort()).toEqual([200, 409]);

  const revises = await Promise.all([
    verb(draft.id, 'revise'),
    verb(draft.id, 'revise'),
  ]);
  expect(revises.map(one => one.status).sort()).toEqual([200, 409]);
  expect(revises.find(one => one.status === 409)?.body['code']).toBe(
    'specificationBeingRevised',
  );
});

it('refuses to publish an offering pinned to a version in design', async () => {
  const draft = (await create('An unreleased product')).body['data'];
  const offering = (
    await call('POST', 'product-offering', {
      meta: { type: 'entity', entity: 'product-offering' },
      data: { name: 'An unreleased offering', specificationId: draft.id },
    })
  ).body['data'];
  await call('POST', 'product-offering-price', {
    meta: { type: 'entity', entity: 'product-offering-price' },
    data: { offeringId: offering.id, amount: 1500, currency: 'GTQ' },
  });

  const refused = await call(
    'POST',
    `product-offering/${offering.id}/publish`,
    {},
  );

  expect(refused.status).toBe(409);
  expect(refused.body['code']).toBe('specificationNotActive');
});

it('copies the version a line was sold under onto the order', async () => {
  const offering = await sellable(HARDWARE.organizationId);
  const published = await (
    await mongo('marketplace')
  )
    .collection('published-offering')
    .findOne({ offeringId: offering.offeringId });

  const checkout = await startCheckout([
    {
      vendorId: HARDWARE.organizationId,
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
  expect(checkout.status).toBe(202);
  expect(
    (await settled(checkout.flowId, { capability: checkout.capability })).state,
  ).toBe('completed');

  const [order] = await ordersOf(checkout.flowId);
  expect(order?.['items']?.[0]).toMatchObject({
    specificationId: published?.['specificationId'],
    specificationVersion: 1,
  });
});
