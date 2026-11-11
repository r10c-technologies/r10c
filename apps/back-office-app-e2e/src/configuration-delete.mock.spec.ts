import { expect, record, test } from './support/fixtures';

/**
 * A configuration row is a value the fleet boots from, so deleting one is
 * typed (#527): the dialog names the row by its key, and its verb stays
 * disabled until that name is typed.
 */
test('deleting a configuration row requires typing its name', async ({
  page,
}) => {
  await page.goto('/es/system/configuration');
  await record(page, 'cod.maxAmount').first().getByRole('link').first().click();
  // The form is interactive once the record it edits has landed in it.
  await expect(page.getByRole('textbox', { name: 'Clave' })).toHaveValue(
    'cod.maxAmount',
  );

  await page.getByRole('button', { name: 'Eliminar' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toHaveAccessibleName('¿Eliminar cod.maxAmount?');
  const verb = dialog.getByRole('button', { name: 'Eliminar' });
  await expect(verb).toBeDisabled();

  await dialog.getByRole('textbox').fill('cod');
  await expect(verb).toBeDisabled();
  await dialog.getByRole('textbox').fill('cod.maxAmount');
  await expect(verb).toBeEnabled();
});
