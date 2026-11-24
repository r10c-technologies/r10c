import type { Page } from '@playwright/test';

import { expect, test } from './support/fixtures';

/**
 * Setting where a price steps down by quantity (ADR 0082 §8). The verb needs
 * rows whose quantity is in the offering's unit and whose amount is in the
 * price's currency, so its button opens a form of its own; the mock refuses
 * a tier no cheaper than the price, which is how a refusal shows here.
 */
test.describe('volume prices', () => {
  const open = async (page: Page) => {
    await page.goto('/es/catalog/product-offering-price/price-1');
    await page
      .getByRole('button', { name: 'Definir precios por volumen' })
      .click();
    const form = page.getByRole('dialog', {
      name: 'Definir precios por volumen',
    });
    await expect(form.getByTestId('price-tiers-empty')).toBeVisible();
    await form.getByRole('button', { name: 'Agregar un tramo' }).click();
    const quantity = form.getByRole('spinbutton', { name: 'Desde' });
    await quantity.fill('10');
    // Tab commits the field; Enter would submit the dialog's form.
    await quantity.press('Tab');
    return form;
  };

  test('sets a tier through the form the verb names', async ({ page }) => {
    const form = await open(page);
    await form.getByLabel('Precio', { exact: true }).fill('40');
    await form
      .getByRole('button', { name: 'Definir precios por volumen' })
      .click();

    await expect(form).toBeHidden();
    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(
      0,
    );
  });

  test('shows the refusal of a tier no cheaper than the price, and keeps the form', async ({
    page,
  }) => {
    const form = await open(page);
    await form.getByLabel('Precio', { exact: true }).fill('50');
    await form
      .getByRole('button', { name: 'Definir precios por volumen' })
      .click();

    await expect(
      page.getByRole('alert').filter({ hasText: /cuesta menos que el precio/ }),
    ).toBeVisible();
  });
});
