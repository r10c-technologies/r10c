import { expect, record, test } from './support/fixtures';

/**
 * The operator's list of phones a product can fit (plan 1.17): reached from
 * the nav like any vocabulary, and retired rather than deleted, because a
 * specification in another store holds the bare id.
 */
test('lists the phone models and retires one with Undo', async ({ page }) => {
  await page.goto('/es/catalog/device-model');

  await expect(
    page.getByRole('heading', { name: 'Modelos de teléfono' }),
  ).toBeVisible();
  await expect(record(page, 'Samsung Galaxy A15')).toContainText('Samsung');

  await page
    .getByRole('checkbox', { name: 'Seleccionar Samsung Galaxy A15' })
    .check();
  await page.getByRole('button', { name: 'Retirar' }).click();
  await expect(record(page, 'Samsung Galaxy A15')).toContainText('Retirado');

  await page.getByRole('button', { name: 'Deshacer' }).click();
  await expect(record(page, 'Samsung Galaxy A15')).toContainText('Activo');
});
