import { brandVerbs, expect, record, test } from './support/fixtures';

/**
 * Retiring a brand acts at once and offers Undo, which restores the same
 * selection (entifix ADR 0026, #523). Retiring is undone by its own inverse
 * verb, so asking first would be a dialog guarding nothing that Undo does not
 * already guard. Mock-only: what is asserted is that the list runs `retire`,
 * then `restore` over the same ids, and that the row reads active again.
 */
test('retires a brand at once, and Undo restores it', async ({ page }) => {
  await page.goto('/catalog/product-brand');

  await page.getByRole('checkbox', { name: 'Seleccionar Globex 1' }).check();
  await page.getByRole('button', { name: 'Retirar' }).click();

  // No dialog: the verb ran, and the toast says so with a way back.
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect
    .poll(() => brandVerbs.at(-1))
    .toEqual({ verb: 'retire', ids: ['product-brand-2'] });

  await page.getByRole('button', { name: 'Deshacer' }).click();

  await expect
    .poll(() => brandVerbs.at(-1))
    .toEqual({ verb: 'restore', ids: ['product-brand-2'] });
  await expect(record(page, 'Globex 1')).toContainText('Activo');
});
