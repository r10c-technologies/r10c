import { http, HttpResponse } from 'msw';

import { BRAND_URL, expect, test } from './support/fixtures';

/**
 * A failure's next step (#527, entifix ADR 0028): a region showing
 * `noActiveOrganization` offers **Elegir organización**, which opens the
 * switcher, and one showing `forbidden` offers who can grant access.
 */
const answering = (code: string, status: number) =>
  http.get(BRAND_URL, () =>
    HttpResponse.json(
      { type: 'about:blank', code, status },
      { status, headers: { 'content-type': 'application/problem+json' } },
    ),
  );

test('a missing organization offers to choose one', async ({
  page,
  network,
}) => {
  network.use(answering('noActiveOrganization', 409));
  await page.goto('/es/catalog/product-brand');

  await page
    .getByTestId('region-state-error')
    .getByRole('button', { name: 'Elegir organización' })
    .click();

  const dialog = page.getByRole('dialog', { name: 'Cambiar de organización' });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: /Demo Vendor/ }),
  ).toHaveAttribute('aria-current', 'true');
});

test('a refusal offers who can grant access', async ({ page, network }) => {
  network.use(answering('forbidden', 403));
  await page.goto('/es/catalog/product-brand');

  await page
    .getByTestId('region-state-error')
    .getByRole('button', { name: '¿Quién puede darme acceso?' })
    .click();

  const dialog = page.getByRole('dialog', {
    name: '¿Quién puede darme acceso?',
  });
  await expect(dialog).toContainText(
    'Los permisos los conceden los administradores de Demo Vendor.',
  );
  await dialog.getByRole('button', { name: 'Cerrar' }).click();
  await expect(dialog).toBeHidden();
});
