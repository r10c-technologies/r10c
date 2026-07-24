import type { Page, Request } from '@playwright/test';
import {
  EntityTablePage,
  type NetworkFixture,
} from '@r10c/entifix-ts-testing-e2e/playwright';
import { http, HttpResponse } from 'msw';

import { BRAND_URL, expect, test } from './support/fixtures';

/**
 * What the UI puts *on the wire*, and what it does when the wire answers badly.
 *
 * Mock-only by nature, not by convenience: asserting the exact `rsql=`
 * expression means observing the request, and asserting the error state means
 * choosing the response — neither is available against a live service.
 *
 * The complement of `catalog-filtering.spec.ts`: that file owns the journeys
 * (what the user sees), this one owns the protocol (what the client emits).
 */

/** Records every brand request the page makes, in order. */
const recordRequests = (page: Page): Request[] => {
  const requests: Request[] = [];
  page.on('request', request => {
    if (request.url().startsWith(BRAND_URL)) requests.push(request);
  });
  return requests;
};

const lastQuery = (requests: Request[]): URLSearchParams => {
  const latest = requests[requests.length - 1];
  if (!latest) throw new Error('no entity request was made');
  return new URL(latest.url()).searchParams;
};

const openBrands = async (page: Page) => {
  const requests = recordRequests(page);
  const table = new EntityTablePage(page);
  await page.goto('/catalog/product-brand');
  await table.waitForRows();
  return { table, requests };
};

/** Waits for a request beyond the ones already seen, then reads its query. */
const nextQuery = async (requests: Request[], before: number) => {
  await expect
    .poll(() => requests.length, { message: 'expected a new entity request' })
    .toBeGreaterThan(before);
  return lastQuery(requests);
};

test.describe('the query the catalog emits', () => {
  test('sends a substring filter as RSQL', async ({ page }) => {
    const { table, requests } = await openBrands(page);
    const before = requests.length;

    await table.filterBy({ member: 'name', operator: 'like', value: 'Acme' });

    expect((await nextQuery(requests, before)).get('rsql')).toBe(
      'name=like=Acme',
    );
  });

  test('quotes a value that carries a space', async ({ page }) => {
    const { table, requests } = await openBrands(page);
    const before = requests.length;

    await table.filterBy({ member: 'name', operator: 'eq', value: 'Acme 1' });

    // Unquoted, the expression would not survive the tokenizer.
    expect((await nextQuery(requests, before)).get('rsql')).toBe(
      "name=='Acme 1'",
    );
  });

  test('joins two rows with and', async ({ page }) => {
    const { table, requests } = await openBrands(page);
    const before = requests.length;

    await table.filterBy(
      { member: 'name', operator: 'like', value: 'Acme' },
      { member: 'code', operator: 'like', value: 'brand' },
    );

    expect((await nextQuery(requests, before)).get('rsql')).toBe(
      'name=like=Acme;code=like=brand',
    );
  });

  test('brackets an or group', async ({ page }) => {
    const { table, requests } = await openBrands(page);
    const before = requests.length;

    await table.openFilters();
    await table.matchAny('or');
    await table.addFilter({ member: 'name', operator: 'like', value: 'Acme' });
    await table.addFilter({ member: 'code', operator: 'like', value: 'brand' });
    await table.applyFilters();

    // Parenthesized because top-level entries are joined with `;`: an
    // unbracketed `,` group would change meaning as soon as a second entry
    // appeared beside it.
    expect((await nextQuery(requests, before)).get('rsql')).toBe(
      '(name=like=Acme,code=like=brand)',
    );
  });

  test('sends signed, precedence-ordered sort terms', async ({ page }) => {
    const { table, requests } = await openBrands(page);
    const before = requests.length;

    await table.sortBy(
      { member: 'name', direction: 'desc' },
      { member: 'code' },
    );

    expect((await nextQuery(requests, before)).get('sort')).toBe('-name,+code');
  });

  test('carries filtering, sorting and paging in one request', async ({
    page,
  }) => {
    const { table, requests } = await openBrands(page);

    await table.filterBy({ member: 'name', operator: 'like', value: 'Acme' });
    await expect
      .poll(() => lastQuery(requests).get('rsql'))
      .toBe('name=like=Acme');

    const before = requests.length;
    await table.sortBy({ member: 'name', direction: 'desc' });

    const query = await nextQuery(requests, before);
    expect(query.get('rsql')).toBe('name=like=Acme');
    expect(query.get('sort')).toBe('-name');
    expect(query.get('page')).toBe('1');
  });

  test('drops the filter again on clear', async ({ page }) => {
    const { table, requests } = await openBrands(page);

    await table.filterBy({ member: 'name', operator: 'like', value: 'Acme' });
    await expect
      .poll(() => lastQuery(requests).get('rsql'))
      .toBe('name=like=Acme');

    await table.clearFilters();

    // Clearing returns to the unfiltered first page — served from the query
    // cache, so it need not hit the wire again — and never puts a match-all
    // filter on it. The restored full set is the observable proof.
    await expect
      .poll(async () =>
        (await table.columnValues('Name')).some(
          name => !name.includes('Acme'),
        ),
      )
      .toBe(true);
    for (const request of requests) {
      const rsql = new URL(request.url()).searchParams.get('rsql');
      expect(rsql === null || rsql === 'name=like=Acme').toBe(true);
    }
  });

  // Wired straight through, the panel would put one request on the wire per
  // character typed.
  test('sends nothing until the panel is applied', async ({ page }) => {
    const { table, requests } = await openBrands(page);
    const before = requests.length;

    // Armed before the edit: a request fired by any keystroke would resolve it,
    // and the quiet window is the assertion — there is no positive event to
    // wait for.
    const premature = page
      .waitForRequest(`${BRAND_URL}*`, { timeout: 1_000 })
      .then(request => request.url())
      .catch(() => undefined);

    await table.openFilters();
    await table.addFilter({ member: 'name', operator: 'like', value: 'Acme' });

    expect(await premature).toBeUndefined();
    expect(requests).toHaveLength(before);
  });
});

test.describe('when the service fails', () => {
  // Only reachable by choosing the response, which is why these live here.
  const failTheListing = (network: NetworkFixture) =>
    network.use(
      http.get(BRAND_URL, () => new HttpResponse(null, { status: 500 })),
    );

  test('tells the user the listing failed to load', async ({
    page,
    network,
  }) => {
    failTheListing(network);

    await page.goto('/catalog/product-brand');

    await expect(page.getByRole('alert').first()).toBeVisible();
  });

  // The regression this suite was written for: a service that is down must not
  // look like a catalog that is empty. "No records" is a statement about the
  // data, and after a failed load it is a lie about it.
  test('does not claim the catalog is empty', async ({ page, network }) => {
    failTheListing(network);

    await page.goto('/catalog/product-brand');

    await expect(page.locator('table tbody tr td').first()).toHaveText(
      'Could not load records',
    );
    await expect(page.getByText('No records')).toHaveCount(0);
  });
});
