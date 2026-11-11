import { expectAccessible } from './a11y';
import { expect, test } from './support/fixtures';

/**
 * Theme and density are the reader's preference, chosen in the account menu
 * and rendered with the page on the next load (#530): the root layout reads
 * the cookie, so nothing changes after `DOMContentLoaded`.
 */
test('a chosen theme and density survive a reload, applied before load', async ({
  page,
}) => {
  await page.goto('/es/catalog/product-brand');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'ocean');
  await expect(html).toHaveAttribute('data-density', 'compact');

  await page.getByRole('button', { name: 'Cuenta', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Medianoche' }).click();
  await page.getByRole('button', { name: 'Cuenta', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Cómoda' }).click();
  await expect(html).toHaveAttribute('data-theme', 'midnight');
  await expect(html).toHaveAttribute('data-density', 'comfortable');

  // Every write to either attribute from here on, recorded from the first
  // script the reloaded page runs.
  await page.addInitScript(() => {
    const changes: string[] = [];
    (window as unknown as { themeChanges: string[] }).themeChanges = changes;
    new MutationObserver(records => {
      for (const record of records) {
        changes.push(
          `${record.attributeName ?? ''}:${String(document.readyState)}`,
        );
      }
    }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-density'],
    });
  });
  await page.reload();

  await expect(html).toHaveAttribute('data-theme', 'midnight');
  await expect(html).toHaveAttribute('data-density', 'comfortable');
  const changes = await page.evaluate(
    () => (window as unknown as { themeChanges: string[] }).themeChanges,
  );
  expect(changes.filter(change => !change.endsWith(':loading'))).toEqual([]);
});

test('the account menu with its new controls meets the gate', async ({
  page,
}) => {
  await page.goto('/es/catalog/product-brand');
  await page.getByRole('button', { name: 'Cuenta', exact: true }).click();
  await expect(
    page.getByRole('menuitemradio', { name: 'Océano' }),
  ).toBeVisible();

  await expectAccessible(page, 'account-menu:ocean');
});
