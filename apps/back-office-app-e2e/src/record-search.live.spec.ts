import {
  baseTest as test,
  expect,
  seedSession,
} from '@entifix/testing-e2e/playwright';

/**
 * Record search names what it finds, and finds it by that name (#552).
 *
 * Live only, and through the app's own `GET /api/search`: the fan-out runs in
 * the Next server, which dials each service directly, so a mock journey could
 * only stub the very thing worth proving. Here a real session reaches the
 * route, the route reads the target's owner first — marketplace-admin-service
 * for an offering's name, marketplace-service for a vendor's — and then the
 * records that refer to the matches.
 *
 * Alan, because stock and settlement are the demo organization's: a vendor's
 * reads are narrowed to their own records.
 */

const VENDOR = 'alan@example.com';

/** Every seeded offering is called `<specification> — oferta`. */
const OFFERING_TERM = 'oferta';

/** The demo organization's display name, from the seeded vendors. */
const VENDOR_NAME = 'Demo Vendor';

/** What a raw id reads like: a UUID, or a seeded `<key>-<n>`. */
const RAW_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-|^[a-z]+(-[a-z]+)*-\d+$/;

interface Option {
  readonly label: string;
}
interface Group {
  readonly source: string;
  readonly items: readonly Option[];
}

const search = async (
  page: import('@playwright/test').Page,
  term: string,
  sources: string,
): Promise<readonly Group[]> => {
  const response = await page.request.get(
    `/api/search?q=${encodeURIComponent(term)}&sources=${sources}&limit=5`,
  );
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    groups: readonly Group[];
    unavailable: readonly unknown[];
  };
  expect(body.unavailable).toEqual([]);
  return body.groups;
};

test.beforeEach(async ({ context }) => {
  await seedSession(context, { identifier: VENDOR });
});

test('finds a stock position by its product’s name, and calls it that', async ({
  page,
}) => {
  const groups = await search(
    page,
    OFFERING_TERM,
    'stock-item,stock-movement,reservation',
  );
  const items = groups.flatMap(group => group.items);

  expect(
    groups.find(group => group.source === 'stock-item')?.items.length,
  ).toBeGreaterThan(0);
  for (const { label } of items) {
    expect(label).toContain(OFFERING_TERM);
    expect(label).not.toMatch(RAW_ID);
  }
});

test('finds a vendor’s agreement and payouts by the vendor’s name', async ({
  page,
}) => {
  const groups = await search(page, VENDOR_NAME, 'agreement,vendor-payout');

  expect(
    groups.find(group => group.source === 'agreement')?.items,
  ).toContainEqual(expect.objectContaining({ label: VENDOR_NAME }));
  for (const { label } of groups.flatMap(group => group.items)) {
    expect(label).toBe(VENDOR_NAME);
  }
});

test('finds a vendor’s order by its number, and calls it by that number', async ({
  page,
}) => {
  const list = await page.request.get('/api/order/product-order?limit=1');
  expect(list.status()).toBe(200);
  const body = (await list.json()) as {
    data: { items: readonly { number?: string }[] };
  };
  const number = body.data.items[0]?.number;
  test.skip(number === undefined, 'the demo organization has no order yet');

  const groups = await search(page, String(number), 'product-order');
  const labels = groups.flatMap(group => group.items.map(item => item.label));

  expect(labels).toContain(number);
  for (const label of labels) expect(label).not.toMatch(RAW_ID);
});
