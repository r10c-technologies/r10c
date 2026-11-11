import { expect, test } from './support/fixtures';

/**
 * At 1280px with the sidebar open the table's pane is 61rem, and a list stays
 * a table only while its columns' floors fit it (entifix ADR 0027). The brand
 * list is tuned to fit (#527); configuration and commission entries carry
 * eight and ten columns, which honestly need more room, so they pivot to
 * cards at this width and stay tables on a wider screen.
 */
test.use({ viewport: { width: 1280, height: 800 } });

test('the brand list is a table at 1280px', async ({ page }) => {
  await page.goto('/es/catalog/product-brand');

  await expect(
    page.locator('tr:visible').filter({ hasText: 'Acme 1' }).first(),
  ).toBeVisible();
  await expect(
    page.locator('article:visible').filter({ hasText: 'Acme 1' }),
  ).toHaveCount(0);
});

for (const { path, row } of [
  { path: '/es/settlement/commission-entry', row: 'order-1' },
  { path: '/es/system/configuration', row: 'stock-service-domain' },
]) {
  test(`${path} pivots to cards at 1280px`, async ({ page }) => {
    await page.goto(path);

    await expect(
      page.locator('article:visible').filter({ hasText: row }).first(),
    ).toBeVisible();
  });
}
