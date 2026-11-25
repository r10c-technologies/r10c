import { productSeed } from './support/catalog-seed';
import {
  expect,
  nextVersionId,
  productBackend,
  test,
} from './support/fixtures';

/**
 * #767: a released product version is frozen (ADR 0079 §1). Its form says so
 * and takes no input — no Save, no Delete — and offers the move that is
 * legal: a New version, which opens the draft it wrote, where the edit is
 * made and saved.
 */
test.describe('a released product version', () => {
  test.afterEach(() => {
    productBackend.seed(productSeed.map(row => ({ ...row })));
  });

  test('is read-only, says why, and offers a New version', async ({ page }) => {
    await page.goto('/es/catalog/product/product-1');

    await expect(page.getByTestId('entity-form-read-only')).toHaveText(
      'Esta versión está publicada y no se modifica. Crea una versión nueva para cambiarla.',
    );
    await expect(page.getByLabel('Nombre')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Guardar' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Eliminar' })).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Nueva versión' }),
    ).toBeVisible();
  });

  test('opens the draft a New version writes, where the edit saves', async ({
    page,
  }) => {
    await page.goto('/es/catalog/product/product-1');

    await page.getByRole('button', { name: 'Nueva versión' }).click();

    await expect(page).toHaveURL(
      new RegExp(`/catalog/product/${nextVersionId('product-1')}$`),
    );
    const name = page.getByLabel('Nombre');
    await expect(name).toHaveValue('Widget');
    await name.fill('Widget, segunda versión');
    await page.getByRole('button', { name: 'Guardar' }).click();

    await expect
      .poll(() =>
        productBackend
          .rows()
          .find(row => row['id'] === nextVersionId('product-1')),
      )
      .toMatchObject({
        name: 'Widget, segunda versión',
        lifecycleStatus: 'in-design',
      });
    // The released version is untouched.
    expect(
      productBackend.rows().find(row => row['id'] === 'product-1'),
    ).toMatchObject({ name: 'Widget', lifecycleStatus: 'active' });
  });

  test('stays editable in design', async ({ page }) => {
    await page.goto('/es/catalog/product/product-4');

    await expect(page.getByLabel('Nombre')).toHaveValue('Gizmo');
    await expect(page.getByRole('button', { name: 'Guardar' })).toBeVisible();
    await expect(page.getByTestId('entity-form-read-only')).toHaveCount(0);
  });
});
