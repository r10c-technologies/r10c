import { expect, test } from './support/fixtures';

/**
 * Selling a presentation from another offering's stock (ADR 0082 §7). The
 * verb needs the base and the factor, so its button opens the stock-source
 * form; the mock refuses any other body than a box of twelve plates.
 */
test('draws an offering on another one’s stock, through the form the verb names', async ({
  page,
}) => {
  await page.goto('/es/catalog/product-offering/offering-priced');

  const verb = 'Vender una presentación del mismo inventario';
  await page.getByRole('button', { name: verb }).click();
  const form = page.getByRole('dialog', { name: verb });
  await expect(form.getByText(/comparten un mismo saldo/)).toBeVisible();
  await form
    .getByRole('combobox', { name: 'Toma su inventario de' })
    .selectOption({ label: 'Plato hondo' });
  const factor = form.getByRole('spinbutton', {
    name: 'Cada una toma',
  });
  await factor.fill('12');
  // Tab, never Enter: Enter in a quantity field inside a verb's dialog
  // submits before the field commits its value.
  await factor.press('Tab');
  await form.getByRole('button', { name: verb }).click();

  await expect(form).toBeHidden();
  await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(
    0,
  );
});
