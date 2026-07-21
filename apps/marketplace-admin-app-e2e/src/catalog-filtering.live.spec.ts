import { expect, type Page, test } from '@playwright/test';

/**
 * The same journeys as `catalog-filtering.spec.ts`, but against the real
 * marketplace-admin-service and its Mongo store — so the half the hermetic
 * specs cannot reach (parse → allowlist → Mongo translation) is exercised too.
 *
 * Skipped unless `MARKETPLACE_ADMIN_SERVICE_URL` is set, because it needs the
 * infra stack up:
 *
 *     pnpm nx run marketplace-admin-service:dev
 *     MARKETPLACE_ADMIN_SERVICE_URL=http://localhost:3101 \
 *       pnpm nx e2e marketplace-admin-app-e2e
 *
 * The seed (`apps/marketplace-admin-service/src/product-brand-temp-data.ts`) is
 * 20 brands cycling ten base names, so `Acme` matches `Acme 1` and `Acme 2` —
 * but the seed is not idempotent across service restarts, so a long-lived store
 * holds each of them several times. Assertions are therefore on which names
 * survive a filter, never on how many rows come back.
 */

const SERVICE_URL = process.env['MARKETPLACE_ADMIN_SERVICE_URL'];

// The skip is the gate, not a disabled test: without the service these journeys
// cannot run at all, and CI has no infra stack.
// eslint-disable-next-line playwright/no-skipped-test
test.skip(
  !SERVICE_URL,
  'set MARKETPLACE_ADMIN_SERVICE_URL to run against a live service',
);

/** Rows of the wide (grid) layout; the pivot renders the card list as well. */
const rows = (page: Page) => page.locator('table tbody tr');

/** The `Name` column of every rendered row. */
const names = (page: Page) =>
  page.locator('table tbody tr td:nth-child(3)').allInnerTexts();

const openFilters = (page: Page) =>
  page.getByRole('button', { name: 'Filters', exact: true }).click();

async function filterBy(
  page: Page,
  member: string,
  operator: string,
  value: string,
) {
  await openFilters(page);
  await page.getByRole('button', { name: 'Add filter' }).click();
  await page.getByLabel('Filter member').selectOption(member);
  await page.getByLabel('Filter operator').selectOption(operator);
  await page.getByLabel('Filter value').fill(value);
  await page.getByRole('button', { name: 'Apply filters' }).click();
}

test.describe('catalog filtering against the live service', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/catalog/product-brand');
    await expect(rows(page).first()).toBeVisible();
  });

  test('narrows the listing to the matching brands', async ({ page }) => {
    await filterBy(page, 'name', 'like', 'Acme');

    await expect
      .poll(async () => [...new Set(await names(page))].sort())
      .toEqual(['Acme 1', 'Acme 2']);
  });

  test('narrows further with a second clause', async ({ page }) => {
    await openFilters(page);
    await page.getByRole('button', { name: 'Add filter' }).click();
    await page.getByLabel('Filter member').selectOption('name');
    await page.getByLabel('Filter operator').selectOption('like');
    await page.getByLabel('Filter value').fill('Acme');
    await page.getByRole('button', { name: 'Add filter' }).click();
    await page.getByLabel('Filter member').nth(1).selectOption('name');
    await page.getByLabel('Filter operator').nth(1).selectOption('ne');
    await page.getByLabel('Filter value').nth(1).fill('Acme 1');
    await page.getByRole('button', { name: 'Apply filters' }).click();

    await expect
      .poll(async () => [...new Set(await names(page))])
      .toEqual(['Acme 2']);
  });

  test('restores the full listing on clear', async ({ page }) => {
    await filterBy(page, 'name', 'like', 'Acme');
    await expect
      .poll(async () => [...new Set(await names(page))].sort())
      .toEqual(['Acme 1', 'Acme 2']);

    await page.getByRole('button', { name: 'Clear filters' }).click();

    // The listing holds a name the filter had excluded again. Row *count* is
    // not asserted: duplicate seeded ids make React render more rows than the
    // page holds, which says nothing about the query.
    await expect
      .poll(async () =>
        (await names(page)).some(name => !name.includes('Acme')),
      )
      .toBe(true);
  });

  test('reverses the listing when sorted descending', async ({ page }) => {
    const unsorted = new Set(await names(page));

    await page.getByRole('button', { name: 'Sorting', exact: true }).click();
    await page.getByRole('button', { name: 'Add sort' }).click();
    await page.getByLabel('Sort member').selectOption('name');
    await page.getByLabel('Sort direction').selectOption('desc');
    await page.getByRole('button', { name: 'Apply sorting' }).click();

    // Descending by name, so page 1 holds the alphabetical tail — a different
    // set of brands than the unsorted page, which starts at `Acme`.
    await expect
      .poll(async () =>
        [...new Set(await names(page))].every(n => unsorted.has(n)),
      )
      .toBe(false);
    await expect
      .poll(async () => (await names(page)).some(n => n.startsWith('Wonka')))
      .toBe(true);
  });

  // The metadata allowlist rejects a member the entity never exposed. Driven
  // through the API directly: the UI cannot compose such a query, which is the
  // point — the guard is on the server, not in the form.
  test('rejects a query naming a non-filterable member', async ({
    request,
  }) => {
    const response = await request.get(
      `${SERVICE_URL}/api/product-brand?rsql=${encodeURIComponent('nope==1')}`,
    );

    expect(response.status()).toBe(400);
    expect((await response.json()).error).toBe('invalid query');
  });
});
