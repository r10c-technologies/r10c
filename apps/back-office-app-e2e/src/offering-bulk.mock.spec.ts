import { expect, test } from './support/fixtures';

/**
 * Publishing a selection of offerings from the list. Mock-only: what is
 * asserted is that the bulk bar reaches the verb's collection endpoint and
 * renders each row's own outcome — one unpriceable offering does not hide that
 * the other was published, and its refusal reaches the seller translated.
 */
test('publishes a selection and names the offering that has no price', async ({
  page,
}) => {
  await page.goto('/catalog/product-offering');

  await page
    .getByRole('row', { name: /Taza esmaltada/ })
    .getByRole('checkbox')
    .check();
  await page
    .getByRole('row', { name: /Plato hondo/ })
    .getByRole('checkbox')
    .check();
  await page.getByRole('button', { name: 'Publicar' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirmar' })
    .click();

  await expect(
    page.getByText('Agrega un precio antes de publicar esta oferta.'),
  ).toBeVisible();
});
