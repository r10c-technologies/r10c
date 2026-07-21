import type { Page } from '@playwright/test';
import { EntityTablePage } from '@r10c/entifix-ts-testing-e2e/playwright';

import { expect, test } from './support/fixtures';

/**
 * Filtering, sorting and paging from the catalog UI — asserted on what the user
 * ends up looking at.
 *
 * These journeys run in BOTH profiles. In `mock` the browser talks to a fixture
 * backend built from the production query pipeline (RSQL codec → load use-case →
 * Mongo filter translation → fake driver); in `live` it talks to
 * marketplace-admin-service and its real store. Because both ends run the same
 * pipeline the same expectations hold, so a regression anywhere along it fails
 * here whichever profile is running.
 *
 * Assertions are on which brand *names* survive a query, never on how many rows
 * come back: the live seed is not idempotent across service restarts, so a
 * long-lived store holds each brand several times.
 */

const openBrands = async (page: Page): Promise<EntityTablePage> => {
  const table = new EntityTablePage(page);
  await page.goto('/catalog/product-brand');
  await table.waitForRows();
  return table;
};

test.describe('the catalog listing', () => {
  test('narrows to the matching brands', async ({ page }) => {
    const table = await openBrands(page);

    await table.filterBy({ member: 'name', operator: 'like', value: 'Acme' });

    await expect
      .poll(() => table.distinctColumnValues('Name'))
      .toEqual(['Acme 1', 'Acme 2']);
  });

  test('narrows further with a second clause', async ({ page }) => {
    const table = await openBrands(page);

    await table.filterBy(
      { member: 'name', operator: 'like', value: 'Acme' },
      { member: 'name', operator: 'ne', value: 'Acme 1' },
    );

    await expect
      .poll(() => table.distinctColumnValues('Name'))
      .toEqual(['Acme 2']);
  });

  test('matches any clause when set to or', async ({ page }) => {
    const table = await openBrands(page);

    await table.openFilters();
    await table.matchAny('or');
    await table.addFilter({ member: 'name', operator: 'eq', value: 'Acme 1' });
    await table.addFilter({
      member: 'name',
      operator: 'eq',
      value: 'Globex 1',
    });
    await table.applyFilters();

    await expect
      .poll(() => table.distinctColumnValues('Name'))
      .toEqual(['Acme 1', 'Globex 1']);
  });

  test('restores the full listing on clear', async ({ page }) => {
    const table = await openBrands(page);

    await table.filterBy({ member: 'name', operator: 'like', value: 'Acme' });
    await expect
      .poll(() => table.distinctColumnValues('Name'))
      .toEqual(['Acme 1', 'Acme 2']);

    await table.clearFilters();

    // A name the filter had excluded is back. Row *count* is not asserted:
    // duplicate seeded ids make React render more rows than the page holds,
    // which says nothing about the query.
    await expect
      .poll(async () =>
        (await table.columnValues('Name')).some(name => !name.includes('Acme')),
      )
      .toBe(true);
  });

  test('reverses the listing when sorted descending', async ({ page }) => {
    const table = await openBrands(page);

    await table.sortBy({ member: 'name', direction: 'desc' });

    // Descending by name, so page 1 holds the alphabetical tail — `Wonka`,
    // never the `Acme` the unsorted page starts with.
    await expect
      .poll(async () =>
        (await table.columnValues('Name')).some(name =>
          name.startsWith('Wonka'),
        ),
      )
      .toBe(true);
  });

  // Page 2 of the old result is very likely past the end of the narrowed one.
  test('returns to page 1 when a filter is applied', async ({ page }) => {
    const table = await openBrands(page);

    await table.nextPage();
    await expect
      .poll(async () => (await table.columnValues('Name')).length)
      .toBeGreaterThan(0);

    await table.filterBy({ member: 'name', operator: 'like', value: 'Acme' });

    // Both `Acme` brands fit on the first page of the narrowed result; had the
    // pager stayed on page 2 the listing would have been empty.
    await expect
      .poll(() => table.distinctColumnValues('Name'))
      .toEqual(['Acme 1', 'Acme 2']);
  });
});
