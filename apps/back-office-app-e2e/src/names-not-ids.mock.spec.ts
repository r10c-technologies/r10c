import { seedSession } from '@entifix/testing-e2e/playwright';

import {
  expect,
  OFFERING_NAMES,
  SERVICE_URL,
  test,
  VENDOR_NAME,
} from './support/fixtures';

/**
 * Every back-office list names what it points at (#552, entifix 0030).
 *
 * A member holding another record's id — a stock item's offering, a payout's
 * vendor, an order's checkout — is declared `references`, and the list reads
 * the target's name through the host's registry, once per page. Before that,
 * these screens printed `product-offering-1` and UUIDs: what the store holds,
 * not what a person reads. So each list is walked and its visible cells are
 * held to two shapes nobody should ever be shown — a UUID, and an entity's
 * key followed by a number, the shape the seeds' ids take.
 *
 * #594: that covers **every** cell, the record's own id included — a list no
 * longer shows its own key (entifix 0.22.3) — and each row still opens by
 * exactly one link, named by the record's name or by its noun and short id,
 * never by a quantity or a status.
 */
const UUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const KEY_ID =
  /\b(product-offering|product-specification|product-brand|product-category|published-vendor|product-order|checkout-group|settlement-run|stock-item|stock-movement|reservation|commission-entry|vendor-payout|shipping-order)-\d+\b|\bagreement-[a-z0-9-]+\b/;

const LISTS = [
  '/es/stock/stock-item',
  '/es/stock/stock-movement',
  '/es/stock/reservation',
  '/es/catalog/product',
  '/es/catalog/product-offering',
  '/es/order/product-order',
  '/es/fulfilment/shipping-order',
  '/es/settlement/agreement',
  '/es/settlement/commission-entry',
  '/es/settlement/settlement-run',
  '/es/settlement/vendor-payout',
];

for (const path of LISTS) {
  test(`${path} shows names, never ids`, async ({ page }) => {
    await page.goto(path);
    const cells = page.getByRole('cell');
    await expect(cells.first()).toBeVisible();
    // Names are read after the rows land; wait until none is pending.
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);

    // Every cell but the selection checkbox, and each row's open links.
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('tbody tr')]
        .filter(row => (row as HTMLElement).offsetParent !== null)
        .map(row => ({
          texts: [...row.querySelectorAll('td')]
            .filter(cell => !cell.querySelector('input'))
            .map(cell => (cell as HTMLElement).innerText),
          links: [...row.querySelectorAll('td a[href]')].map(link =>
            (link as HTMLElement).innerText.trim(),
          ),
        })),
    );
    const texts = rows.flatMap(row => row.texts);
    expect(texts.filter(text => UUID.test(text))).toEqual([]);
    expect(texts.filter(text => KEY_ID.test(text))).toEqual([]);
    expect(rows.length).toBeGreaterThan(0);
    for (const { links } of rows) {
      expect(links).toHaveLength(1);
      expect(links[0]).not.toMatch(/^[\d.,\s-]*$/);
    }
  });
}

test('names a stock item by its offering, and a vendor by its name', async ({
  context,
  page,
}) => {
  await page.goto('/es/stock/stock-item');
  await expect(
    page.getByRole('cell', { name: OFFERING_NAMES[0][1], exact: true }).first(),
  ).toBeVisible();

  // An operator's agreements carry the vendor column; a vendor's do not, since
  // every row is theirs (#559). Re-seeded on the same context, so the mocks
  // stay installed.
  await seedSession(context, {
    roles: ['admin'],
    partyRole: 'operator',
    entitlements: ['settlement-management'],
  });
  await page.goto('/es/settlement/agreement');
  await expect(
    page.getByRole('cell', { name: VENDOR_NAME, exact: true }).first(),
  ).toBeVisible();
});

test('reads one page of names with one request per target', async ({
  page,
}) => {
  const reads: string[] = [];
  page.on('request', request => {
    const url = decodeURIComponent(request.url());
    if (
      url.startsWith(`${SERVICE_URL}/product-offering`) &&
      /id=in=/.test(url)
    ) {
      reads.push(url);
    }
  });

  await page.goto('/es/stock/stock-item');
  await expect(
    page.getByRole('cell', { name: OFFERING_NAMES[0][1], exact: true }).first(),
  ).toBeVisible();

  expect(reads).toHaveLength(1);
});
