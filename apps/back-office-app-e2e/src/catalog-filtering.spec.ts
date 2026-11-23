import {
  EntityTablePage,
  resolveE2eProfile,
} from '@entifix/testing-e2e/playwright';
import type { Page } from '@playwright/test';

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
 *
 * The names differ by profile: the mock serves `support/catalog-seed.ts`'s
 * cycled `Acme 1 … Wonka 2`, and the live fleet the sample stores' invented
 * brands (#676). Each column says the same thing about its own seed.
 */
const BRANDS =
  resolveE2eProfile() === 'live'
    ? {
        term: 'ex',
        matching: ['Pintuflex', 'Suelatex'],
        either: ['Cobrelux', 'Kinetik'],
        last: 'VidrioPro',
      }
    : {
        term: 'Acme',
        matching: ['Acme 1', 'Acme 2'],
        either: ['Acme 1', 'Globex 1'],
        last: 'Wonka',
      };
const [FIRST_MATCH, SECOND_MATCH] = BRANDS.matching as [string, string];
const [EITHER_ONE, EITHER_TWO] = BRANDS.either as [string, string];

const openBrands = async (page: Page): Promise<EntityTablePage> => {
  const table = new EntityTablePage(page);
  await page.goto('/catalog/product-brand');
  await table.waitForRows();
  return table;
};

test.describe('the catalog listing', () => {
  test('narrows to the matching brands', async ({ page }) => {
    const table = await openBrands(page);

    await table.filterBy({
      member: 'name',
      operator: 'like',
      value: BRANDS.term,
    });

    await expect
      .poll(() => table.distinctColumnValues('Nombre'))
      .toEqual(BRANDS.matching);
  });

  test('narrows further with a second clause', async ({ page }) => {
    const table = await openBrands(page);

    await table.filterBy(
      { member: 'name', operator: 'like', value: BRANDS.term },
      { member: 'name', operator: 'ne', value: FIRST_MATCH },
    );

    await expect
      .poll(() => table.distinctColumnValues('Nombre'))
      .toEqual([SECOND_MATCH]);
  });

  test('matches any clause when set to or', async ({ page }) => {
    const table = await openBrands(page);

    await table.openFilters();
    await table.matchAny('or');
    await table.addFilter({
      member: 'name',
      operator: 'eq',
      value: EITHER_ONE,
    });
    await table.addFilter({
      member: 'name',
      operator: 'eq',
      value: EITHER_TWO,
    });
    await table.applyFilters();

    await expect
      .poll(() => table.distinctColumnValues('Nombre'))
      .toEqual(BRANDS.either);
  });

  test('restores the full listing on clear', async ({ page }) => {
    const table = await openBrands(page);

    await table.filterBy({
      member: 'name',
      operator: 'like',
      value: BRANDS.term,
    });
    await expect
      .poll(() => table.distinctColumnValues('Nombre'))
      .toEqual(BRANDS.matching);

    await table.clearFilters();

    // A name the filter had excluded is back. Row *count* is not asserted:
    // duplicate seeded ids make React render more rows than the page holds,
    // which says nothing about the query.
    await expect
      .poll(async () =>
        (await table.columnValues('Nombre')).some(
          name => !BRANDS.matching.includes(name),
        ),
      )
      .toBe(true);
  });

  test('reverses the listing when sorted descending', async ({ page }) => {
    const table = await openBrands(page);

    await table.sortBy({ member: 'name', direction: 'desc' });

    // Descending by name, so page 1 holds the alphabetical tail — the last
    // name, which the unsorted first page does not start with.
    await expect
      .poll(async () =>
        (await table.columnValues('Nombre')).some(name =>
          name.startsWith(BRANDS.last),
        ),
      )
      .toBe(true);
  });

  // Page 2 of the old result is very likely past the end of the narrowed one.
  test('returns to page 1 when a filter is applied', async ({ page }) => {
    const table = await openBrands(page);

    await table.nextPage();
    await expect
      .poll(async () => (await table.columnValues('Nombre')).length)
      .toBeGreaterThan(0);

    await table.filterBy({
      member: 'name',
      operator: 'like',
      value: BRANDS.term,
    });

    // Both matching brands fit on the first page of the narrowed result; had the
    // pager stayed on page 2 the listing would have been empty.
    await expect
      .poll(() => table.distinctColumnValues('Nombre'))
      .toEqual(BRANDS.matching);
  });
});
