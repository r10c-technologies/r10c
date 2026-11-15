import {
  agreementBackend,
  commissionEntryBackend,
  expect,
  settlementRunBackend,
  test,
  vendorPayoutBackend,
} from './support/fixtures';
import {
  agreementSeed,
  commissionEntrySeed,
  settlementRunSeed,
  vendorPayoutSeed,
} from './support/settlement-seed';

/**
 * A status reads as a tag, and an empty list reads as nothing to list (#552,
 * entifix #230 and #232).
 *
 * Each status member declares `enumTones`, so a list renders it as a
 * `StatusTag` — a tone and the words for it, never the colour alone. The tone
 * is asserted by the tag's `data-tone`, against the one value each seed holds:
 * a published offering succeeds, a paid order and a calculated run are
 * information, a shipment awaiting dispatch warns, an active channel succeeds.
 * `paymentMethod` declares none, so an order row carries exactly one tag.
 */
const TAGGED = [
  { path: '/es/catalog/product-offering', tone: 'success' },
  { path: '/es/order/product-order', tone: 'info' },
  { path: '/es/fulfilment/shipping-order', tone: 'warning' },
  { path: '/es/settlement/settlement-run', tone: 'info' },
  { path: '/es/sales/sales-channel', tone: 'success' },
] as const;

for (const { path, tone } of TAGGED) {
  test(`${path} renders its status as a ${tone} tag`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('cell').first()).toBeVisible();

    const tag = page.locator(`tbody [data-tone="${tone}"]`).first();
    await expect(tag).toBeVisible();
    await expect(tag).not.toHaveText('');
  });
}

test('tags an order’s status and not how it was paid', async ({ page }) => {
  await page.goto('/es/order/product-order');
  // The skeleton's rows are `tbody tr` too, so the rows are counted only once
  // a tag says the page holds records.
  const tags = page.locator('tbody [data-tone]');
  await expect(tags.first()).toBeVisible();

  await expect(tags).toHaveCount(await page.locator('tbody tr').count());
});

const SETTLEMENT_LISTS = [
  {
    path: '/es/settlement/agreement',
    backend: agreementBackend,
    seed: agreementSeed,
  },
  {
    path: '/es/settlement/commission-entry',
    backend: commissionEntryBackend,
    seed: commissionEntrySeed,
  },
  {
    path: '/es/settlement/settlement-run',
    backend: settlementRunBackend,
    seed: settlementRunSeed,
  },
  {
    path: '/es/settlement/vendor-payout',
    backend: vendorPayoutBackend,
    seed: vendorPayoutSeed,
  },
];

for (const { path, backend, seed } of SETTLEMENT_LISTS) {
  test.describe(`${path} with nothing in it`, () => {
    test.beforeEach(() => backend.seed([]));

    test.afterEach(() => backend.seed(seed));

    test('says so, and renders no table', async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByText(/^Aquí aparecerán sus /)).toBeVisible();

      await expect(page.getByRole('table')).toHaveCount(0);
    });
  });
}
