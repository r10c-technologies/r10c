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
 * held to two shapes nobody should ever be shown — a UUID, and a referenced
 * entity's key followed by a number, the shape the seeds' ids take.
 */
const UUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const REFERENCED_KEY_ID =
  /\b(product-offering|product-specification|product-brand|product-category|published-vendor|product-order|checkout-group|settlement-run)-\d+\b/;

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

    // What a reference renders: every cell but the selection checkbox and the
    // record's own `ID` column, which is the record's key rather than a
    // pointer to another one and is out of this check's reach.
    const texts = await page.evaluate(() => {
      const headers = [...document.querySelectorAll('thead th')].map(th =>
        (th.textContent ?? '').trim(),
      );
      const own = headers.indexOf('ID');
      return [...document.querySelectorAll('tbody tr')].flatMap(row =>
        [...row.querySelectorAll('td')]
          .filter(
            (cell, index) => index !== own && !cell.querySelector('input'),
          )
          .map(cell => (cell as HTMLElement).innerText),
      );
    });
    expect(texts.filter(text => UUID.test(text))).toEqual([]);
    expect(texts.filter(text => REFERENCED_KEY_ID.test(text))).toEqual([]);
  });
}

test('names a stock item by its offering, and a vendor by its name', async ({
  page,
}) => {
  await page.goto('/es/stock/stock-item');
  await expect(
    page.getByRole('cell', { name: OFFERING_NAMES[0][1], exact: true }).first(),
  ).toBeVisible();

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
