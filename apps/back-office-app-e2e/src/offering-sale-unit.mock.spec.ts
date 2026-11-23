import { expect, test } from './support/fixtures';

/**
 * Setting what one of an offering is (ADR 0082 §3). The verb needs the unit,
 * so its button opens a form and the verb runs with what the form sends — the
 * mock refuses any other body, which is how a button posting nothing would
 * show here (entifix #315).
 */
test('sets the unit an offering is sold in, through the form the verb names', async ({
  page,
}) => {
  await page.goto('/es/catalog/product-offering/offering-priced');

  await page.getByRole('button', { name: 'Definir unidad de venta' }).click();
  const form = page.getByRole('dialog', { name: 'Definir unidad de venta' });
  await expect(form.getByText(/vuelven a una unidad completa/)).toBeVisible();
  await form
    .getByRole('combobox', { name: 'Unidad de venta' })
    .selectOption('M');
  await form.getByRole('button', { name: 'Definir unidad de venta' }).click();

  await expect(form).toBeHidden();
  // No refusal anywhere: Next's route announcer is an empty alert, so only
  // one that says something counts.
  await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(
    0,
  );
});
