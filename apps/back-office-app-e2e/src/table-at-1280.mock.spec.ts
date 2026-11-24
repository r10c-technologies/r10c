import { expect, test } from './support/fixtures';

/**
 * At 1280px with the sidebar open the table's pane is 61rem. Since entifix
 * 0.21.0 a list pivots to cards only when its **essential** columns stop
 * fitting, and keeps its title column sticky while the rest scroll (entifix
 * #231). So the brand list, configuration and commission entries — eight and
 * ten columns, which pivoted at this width before — all stay tables here.
 */
test.use({ viewport: { width: 1280, height: 800 } });

for (const { path, row } of [
  { path: '/es/catalog/product-brand', row: 'Acme 1' },
  // With its price, picture and stock columns (#558).
  { path: '/es/catalog/product-offering', row: 'Taza de cerámica' },
  { path: '/es/settlement/commission-entry', row: '7KQ4-M2XD' },
  { path: '/es/system/configuration', row: 'stock-service-domain' },
  // Read by number, status, what was bought and the total (#556).
  { path: '/es/order/product-order', row: '7KQ4-M2XD' },
  // Read by number, contents, destination and what is collected (#557).
  { path: '/es/fulfilment/shipping-order', row: 'A1A1-0001' },
]) {
  test(`${path} is a table at 1280px`, async ({ page }) => {
    await page.goto(path);

    await expect(
      page.locator('tr:visible').filter({ hasText: row }).first(),
    ).toBeVisible();
    await expect(
      page.locator('article:visible').filter({ hasText: row }),
    ).toHaveCount(0);
  });
}
