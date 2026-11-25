import { randomUUID } from 'node:crypto';

import {
  closeMongo,
  eventually,
  FLEET,
  HARDWARE,
  mongo,
  vendorBearer,
} from '../support/lab';

/**
 * A catalog loaded from a sheet, on the running fleet
 * ([ADR 0084](../../../../docs/adr/0084-a-catalog-import-is-a-record-and-a-row-is-one-unit-of-work.md)):
 * every row one unit of work on a real replica set, a sheet put on sale
 * reaching the storefront's projection, and a resubmitted sheet — sent ten
 * times at once — writing each product exactly once.
 */
afterAll(closeMongo);

const ROWS = 50;

/** A sheet's rows as the wizard sends them, each name unique to this run. */
const rowsOf = (run: string, count = ROWS) =>
  Array.from({ length: count }, (_, index) => ({
    rowNumber: index + 2,
    name: `Importado ${run} #${String(index + 1)}`,
    amount: 100 + index,
    currency: 'GTQ',
    pricePer: 1,
    saleUnit: 'UN',
    quantityStep: 1,
    quantityMinimum: 1,
  }));

const importSheet = async (
  key: string,
  mode: 'draft' | 'publish',
  rows: readonly unknown[],
) => {
  const res = await fetch(
    `${FLEET.marketplaceAdmin}/api/catalog-import/import`,
    {
      method: 'POST',
      headers: {
        authorization: await vendorBearer(HARDWARE.organizationId),
        'content-type': 'application/json',
        'idempotency-key': `"${key}"`,
      },
      body: JSON.stringify({ fileName: `${key}.csv`, mode, rows }),
    },
  );
  return {
    status: res.status,
    body: (await res.json()) as Record<string, any>,
  };
};

const tenant = () => mongo(`tenant_${HARDWARE.organizationId}`);

const named = async (prefix: string) =>
  (await tenant())
    .collection('product-specification')
    .countDocuments({ name: { $regex: `^${prefix}` } });

it('puts a sheet on sale: each row released, published and projected', async () => {
  const run = randomUUID().slice(0, 8);
  const answered = await importSheet(randomUUID(), 'publish', rowsOf(run));

  expect(answered.status).toBe(200);
  expect(answered.body['data']).toMatchObject({
    status: 'completed',
    rowCount: ROWS,
    createdCount: ROWS,
    rejectedCount: 0,
  });

  const specifications = await (
    await tenant()
  )
    .collection('product-specification')
    .find({ name: { $regex: `^Importado ${run} ` } })
    .toArray();
  expect(specifications).toHaveLength(ROWS);
  expect(
    specifications.every(
      one =>
        one['lifecycleStatus'] === 'active' &&
        /^[0-9a-f]{64}$/.test(String(one['contentHash'])),
    ),
  ).toBe(true);
  // Every code drawn from the one counter, none shared.
  expect(new Set(specifications.map(one => one['code'])).size).toBe(ROWS);

  await eventually(
    async () =>
      (await mongo('marketplace'))
        .collection('published-offering')
        .countDocuments({ name: { $regex: `^Importado ${run} ` } }),
    count => count === ROWS,
    { what: `${String(ROWS)} imported offerings on the storefront` },
  );
});

it('reports a refused row with its code and writes the rest', async () => {
  const run = randomUUID().slice(0, 8);
  const [first, second] = rowsOf(run, 2);
  const answered = await importSheet(randomUUID(), 'draft', [
    first,
    second,
    { ...second, rowNumber: 4 },
    {
      ...first,
      rowNumber: 5,
      name: `Importado ${run} malo`,
      quantityMinimum: 3,
      quantityStep: 2,
    },
  ]);

  expect(answered.body['data']).toMatchObject({
    status: 'partial',
    createdCount: 2,
    rejectedCount: 2,
    rejections: [
      { rowNumber: 4, code: 'importDuplicate', column: 'name' },
      { rowNumber: 5, code: 'saleRuleInvalid', column: 'minimum' },
    ],
  });
  expect(await named(`Importado ${run} `)).toBe(2);
});

it('writes each product once when one sheet is sent ten times at once', async () => {
  const run = randomUUID().slice(0, 8);
  const key = randomUUID();
  const rows = rowsOf(run);

  const answers = await Promise.all(
    Array.from({ length: 10 }, () => importSheet(key, 'draft', rows)),
  );

  // Every attempt is answered the one record — or told the key is in flight,
  // and a retry of that one answers the record too.
  for (const answer of answers.filter(one => one.status !== 200)) {
    expect(answer.status).toBe(409);
  }
  const record = await importSheet(key, 'draft', rows);
  expect(record.body['data']).toMatchObject({
    id: key,
    createdCount: ROWS,
    rejectedCount: 0,
  });
  expect(await named(`Importado ${run} `)).toBe(ROWS);
  expect(
    await (
      await tenant()
    )
      .collection('product-offering')
      .countDocuments({ name: { $regex: `^Importado ${run} ` } }),
  ).toBe(ROWS);
});

it('refuses a sheet past the cap before writing a row', async () => {
  const run = randomUUID().slice(0, 8);
  const answered = await importSheet(randomUUID(), 'draft', rowsOf(run, 501));

  expect(answered.status).toBe(400);
  expect(answered.body['code']).toBe('importTooLarge');
  expect(await named(`Importado ${run} `)).toBe(0);
});
