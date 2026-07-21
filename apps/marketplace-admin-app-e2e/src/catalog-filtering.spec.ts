import { expect, type Page, type Request, test } from '@playwright/test';

/**
 * Filtering/sorting from the catalog UI, asserted on the wire.
 *
 * These specs are hermetic: both the configuration lookup and the entity
 * request are intercepted, so they need neither config-service nor
 * marketplace-admin-service running. Two interceptions are required, not one —
 * the browser adapter resolves its base URL through the app's `/api/config`
 * route before it can issue any entity request, so stubbing only the entity
 * endpoint would leave the page stuck and the spec passing vacuously.
 *
 * What is under test is the *query the UI emits*: the RSQL expression, the sort
 * terms, and the paging that goes with them.
 */

const SERVICE_URL = 'http://localhost:3101/api';

/** The one configuration value the REST adapters need to build their URLs. */
const CONFIGURATION = {
  uri: [{ key: 'marketplace-admin-service-domain', value: SERVICE_URL }],
};

const BRANDS = [
  {
    id: 'product-brand-1',
    code: 'brand-001',
    name: 'Acme 1',
    description: 'a',
    website: 'https://acme.example.com',
  },
  {
    id: 'product-brand-2',
    code: 'brand-002',
    name: 'Globex 1',
    description: 'b',
    website: 'https://globex.example.com',
  },
];

/**
 * Reported total, deliberately larger than the stubbed page: the pager only
 * enables `Next` when there is more than one page, and one spec needs to walk
 * off page 1 to prove a filter brings it back.
 */
const TOTAL = 25;

/**
 * Installs both stubs and returns the entity requests as they arrive, so a spec
 * can assert on the last query the UI produced.
 */
async function stubCatalog(page: Page): Promise<Request[]> {
  const requests: Request[] = [];

  await page.route('**/api/config', route =>
    route.fulfill({ json: CONFIGURATION }),
  );

  await page.route(`${SERVICE_URL}/product-brand*`, route => {
    requests.push(route.request());
    return route.fulfill({
      json: {
        meta: { type: 'entityPage', entity: 'product-brand' },
        data: { items: BRANDS, total: TOTAL, request: {} },
      },
    });
  });

  return requests;
}

/** The decoded query of the most recent entity request. */
function lastQuery(requests: Request[]): URLSearchParams {
  const latest = requests[requests.length - 1];
  if (!latest) throw new Error('no entity request was made');
  return new URL(latest.url()).searchParams;
}

/** Waits until an entity request lands beyond the ones already seen. */
async function nextRequest(page: Page, requests: Request[], before: number) {
  await expect
    .poll(() => requests.length, { message: 'expected a new entity request' })
    .toBeGreaterThan(before);
  return lastQuery(requests);
}

const openBrands = async (page: Page, requests: Request[]) => {
  await page.goto('/catalog/product-brand');
  await expect.poll(() => requests.length).toBeGreaterThan(0);
};

const openFilters = (page: Page) =>
  page.getByRole('button', { name: 'Filters', exact: true }).click();

const addFilterRow = (page: Page) =>
  page.getByRole('button', { name: 'Add filter' }).click();

const applyFilters = (page: Page) =>
  page.getByRole('button', { name: 'Apply filters' }).click();

/**
 * Fills one filter row. The member is always chosen explicitly: a new row
 * defaults to the entity's *first filterable* member, which for `ProductBrand`
 * is `code` (`id` is not filterable), and a spec that relied on that default
 * would break the moment a member is added ahead of it.
 */
async function fillFilterRow(
  page: Page,
  index: number,
  member: string,
  operator: string,
  value: string,
) {
  await page.getByLabel('Filter member').nth(index).selectOption(member);
  await page.getByLabel('Filter operator').nth(index).selectOption(operator);
  await page.getByLabel('Filter value').nth(index).fill(value);
}

test.describe('catalog filtering', () => {
  test('sends a substring filter as RSQL', async ({ page }) => {
    const requests = await stubCatalog(page);
    await openBrands(page, requests);
    const before = requests.length;

    await openFilters(page);
    await addFilterRow(page);
    await fillFilterRow(page, 0, 'name', 'like', 'Acme');
    await applyFilters(page);

    const query = await nextRequest(page, requests, before);
    expect(query.get('rsql')).toBe('name=like=Acme');
  });

  test('sends an exact match as RSQL', async ({ page }) => {
    const requests = await stubCatalog(page);
    await openBrands(page, requests);
    const before = requests.length;

    await openFilters(page);
    await addFilterRow(page);
    await fillFilterRow(page, 0, 'name', 'eq', 'Acme 1');
    await applyFilters(page);

    const query = await nextRequest(page, requests, before);
    // The value carries a space, so it has to arrive quoted or the expression
    // would not survive the tokenizer.
    expect(query.get('rsql')).toBe("name=='Acme 1'");
  });

  test('joins two rows with and', async ({ page }) => {
    const requests = await stubCatalog(page);
    await openBrands(page, requests);
    const before = requests.length;

    await openFilters(page);
    await addFilterRow(page);
    await fillFilterRow(page, 0, 'name', 'like', 'Acme');
    await addFilterRow(page);
    await fillFilterRow(page, 1, 'code', 'like', 'brand');
    await applyFilters(page);

    const query = await nextRequest(page, requests, before);
    expect(query.get('rsql')).toBe('name=like=Acme;code=like=brand');
  });

  test('joins two rows with or when matching any', async ({ page }) => {
    const requests = await stubCatalog(page);
    await openBrands(page, requests);
    const before = requests.length;

    await openFilters(page);
    await page.getByLabel('Match all or any filter').selectOption('or');
    await addFilterRow(page);
    await fillFilterRow(page, 0, 'name', 'like', 'Acme');
    await addFilterRow(page);
    await fillFilterRow(page, 1, 'code', 'like', 'brand');
    await applyFilters(page);

    const query = await nextRequest(page, requests, before);
    // Parenthesized because top-level entries are joined with `;`: an unbracketed
    // `,` group would change meaning the moment a second entry is added.
    expect(query.get('rsql')).toBe('(name=like=Acme,code=like=brand)');
  });

  // Editing must stay local: wired straight through, the panel would put one
  // request on the wire per character typed.
  test('sends nothing until the panel is applied', async ({ page }) => {
    const requests = await stubCatalog(page);
    await openBrands(page, requests);
    const before = requests.length;

    // Armed before the edit: a request fired by any keystroke would resolve it,
    // and the window is the assertion — there is no positive event to wait for.
    const premature = page
      .waitForRequest(`${SERVICE_URL}/product-brand*`, { timeout: 1_000 })
      .then(request => request.url())
      .catch(() => undefined);

    await openFilters(page);
    await addFilterRow(page);
    await fillFilterRow(page, 0, 'name', 'like', 'Acme');

    expect(await premature).toBeUndefined();
    expect(requests).toHaveLength(before);
  });

  test('drops the filter again on clear', async ({ page }) => {
    const requests = await stubCatalog(page);
    await openBrands(page, requests);

    await openFilters(page);
    await addFilterRow(page);
    await fillFilterRow(page, 0, 'name', 'like', 'Acme');
    await applyFilters(page);
    await expect
      .poll(() => lastQuery(requests).get('rsql'))
      .toBe('name=like=Acme');

    const before = requests.length;
    await page.getByRole('button', { name: 'Clear filters' }).click();

    const query = await nextRequest(page, requests, before);
    expect(query.has('rsql')).toBe(false);
  });

  // Page 3 of the old result is very likely past the end of the narrowed one.
  test('returns to page 1 when a filter is applied', async ({ page }) => {
    const requests = await stubCatalog(page);
    await openBrands(page, requests);

    // `exact` matters: Next.js' dev-tools button also matches a loose "Next".
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect.poll(() => lastQuery(requests).get('page')).toBe('2');

    const before = requests.length;
    await openFilters(page);
    await addFilterRow(page);
    await fillFilterRow(page, 0, 'name', 'like', 'Acme');
    await applyFilters(page);

    const query = await nextRequest(page, requests, before);
    expect(query.get('page')).toBe('1');
  });
});

test.describe('catalog sorting', () => {
  test('sends signed, precedence-ordered sort terms', async ({ page }) => {
    const requests = await stubCatalog(page);
    await openBrands(page, requests);
    const before = requests.length;

    await page.getByRole('button', { name: 'Sorting', exact: true }).click();
    await page.getByRole('button', { name: 'Add sort' }).click();
    await page.getByLabel('Sort member').selectOption('name');
    await page.getByLabel('Sort direction').selectOption('desc');
    await page.getByRole('button', { name: 'Add sort' }).click();
    await page.getByLabel('Sort member').nth(1).selectOption('code');
    await page.getByRole('button', { name: 'Apply sorting' }).click();

    const query = await nextRequest(page, requests, before);
    expect(query.get('sort')).toBe('-name,+code');
  });

  test('carries filtering and sorting in the same request', async ({
    page,
  }) => {
    const requests = await stubCatalog(page);
    await openBrands(page, requests);

    await openFilters(page);
    await addFilterRow(page);
    await fillFilterRow(page, 0, 'name', 'like', 'Acme');
    await applyFilters(page);
    await expect
      .poll(() => lastQuery(requests).get('rsql'))
      .toBe('name=like=Acme');

    const before = requests.length;
    await page.getByRole('button', { name: 'Sorting', exact: true }).click();
    await page.getByRole('button', { name: 'Add sort' }).click();
    await page.getByLabel('Sort member').selectOption('name');
    await page.getByLabel('Sort direction').selectOption('desc');
    await page.getByRole('button', { name: 'Apply sorting' }).click();

    const query = await nextRequest(page, requests, before);
    expect(query.get('rsql')).toBe('name=like=Acme');
    expect(query.get('sort')).toBe('-name');
    expect(query.get('page')).toBe('1');
  });
});
