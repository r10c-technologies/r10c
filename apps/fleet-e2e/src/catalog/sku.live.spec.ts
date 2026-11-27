import { randomUUID } from 'node:crypto';

import {
  closeMongo,
  eventually,
  FLEET,
  HARDWARE,
  mongo,
  offeringIdOf,
  present,
  vendorBearer,
} from '../support/lab';

/**
 * A vendor's own code on the running fleet (entifix ADR 0034, ADR 0084 §8):
 * unique within the organization's catalog store, enforced by the store's
 * index rather than a read, carried to the storefront, and the key a sheet
 * updates a product by.
 */
afterAll(closeMongo);

const TACO = offeringIdOf(HARDWARE, 'taco-fisher');
const TACO_SKU = 'TACO-FISHER';
const HAMMER = offeringIdOf(HARDWARE, 'martillo-16');

const admin = async (
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

const offering = async (id: string) =>
  (await admin('GET', `product-offering/${id}`)).body['data'] as Record<
    string,
    any
  >;

const projected = async (offeringId: string) =>
  (await mongo('marketplace'))
    .collection('published-offering')
    .findOne({ offeringId });

const priceOf = async (offeringId: string) =>
  present(
    (await (
      await mongo(`tenant_${HARDWARE.organizationId}`)
    )
      .collection('product-offering-price')
      .findOne({ offeringId })) ?? undefined,
    `a price for ${offeringId}`,
  );

/** One sheet row naming the taco by its SKU, at the terms it is sold on. */
const tacoRow = async (amount: number, overrides: object = {}) => {
  const stored = await offering(TACO);
  const price = await priceOf(TACO);
  return {
    rowNumber: 2,
    sku: TACO_SKU,
    name: String(stored['name']),
    amount,
    currency: String(price['currency']),
    pricePer: Number(price['pricePer'] ?? 1),
    saleUnit: String(stored['saleUnit']),
    quantityStep: Number(stored['quantityStep']),
    quantityMinimum: Number(stored['quantityMinimum']),
    ...(Array.isArray(price['tiers']) && price['tiers'].length > 0
      ? { tiers: price['tiers'] }
      : {}),
    ...overrides,
  };
};

const importRows = async (rows: readonly unknown[]) => {
  const answered = await admin('POST', 'catalog-import/import', {
    fileName: 'precios.csv',
    mode: 'draft',
    rows,
  });
  expect(answered.status).toBe(200);
  return answered.body['data'] as Record<string, any>;
};

it('carries a seeded SKU to the storefront and its search words', async () => {
  const row = present(
    (await projected(TACO)) ?? undefined,
    'the taco projected',
  );

  expect(row['sku']).toBe(TACO_SKU);
  expect(String(row['searchText'])).toContain(TACO_SKU);
});

it('refuses a save that takes another offering’s SKU, naming the field', async () => {
  const hammer = await offering(HAMMER);

  const answered = await admin('PUT', `product-offering/${HAMMER}`, {
    meta: { type: 'entity', entity: 'product-offering' },
    data: { ...hammer, sku: TACO_SKU },
  });

  expect(answered.status).toBe(409);
  expect(answered.body).toMatchObject({ code: 'duplicateKey', key: 'sku' });
  expect((await offering(HAMMER))['sku']).toBe(hammer['sku']);
});

it('lets one of a burst of creates take a new SKU, and refuses the rest', async () => {
  const sku = `BURST-${randomUUID().slice(0, 8).toUpperCase()}`;
  const taco = await offering(TACO);

  const answers = await Promise.all(
    Array.from({ length: 6 }, (_, index) =>
      admin('POST', 'product-offering', {
        meta: { type: 'entity', entity: 'product-offering' },
        data: {
          name: `Ráfaga ${sku} #${String(index)}`,
          specificationId: taco['specificationId'],
          sku,
          quantityStep: 1,
          quantityMinimum: 1,
        },
      }),
    ),
  );

  const won = answers.filter(answer => answer.status < 300);
  const lost = answers.filter(answer => answer.status >= 300);
  try {
    expect(won).toHaveLength(1);
    expect(lost.map(answer => [answer.status, answer.body['code']])).toEqual(
      lost.map(() => [409, 'duplicateKey']),
    );
  } finally {
    for (const answer of won)
      await admin(
        'DELETE',
        `product-offering/${String(answer.body['data']['id'])}`,
      );
  }
});

it('reprices a product on sale from a sheet by its SKU, and the storefront follows', async () => {
  const original = Number((await priceOf(TACO))['amount']);
  const repriced = original + 7;

  try {
    const record = await importRows([await tacoRow(repriced)]);
    expect(record).toMatchObject({
      createdCount: 0,
      updatedCount: 1,
      rejectedCount: 0,
    });
    await eventually(
      async () => (await projected(TACO))?.['amount'],
      amount => amount === repriced,
      { what: 'the repriced taco on the storefront' },
    );
  } finally {
    await importRows([await tacoRow(original)]);
  }
  await eventually(
    async () => (await projected(TACO))?.['amount'],
    amount => amount === original,
    { what: 'the taco back at its price' },
  );
});

it('refuses a sheet row that would change the unit a product is sold in', async () => {
  const before = await offering(TACO);

  const record = await importRows([
    await tacoRow(Number((await priceOf(TACO))['amount']), {
      saleUnit: before['saleUnit'] === 'UN' ? 'M' : 'UN',
    }),
  ]);

  expect(record['rejections']).toEqual([
    expect.objectContaining({ code: 'saleUnitFixed', column: 'unit' }),
  ]);
  expect((await offering(TACO))['revision']).toBe(before['revision']);
});
