import { http, HttpResponse } from 'msw';

import { APP_URL, expect, sessionVerbs, test } from './support/fixtures';

/**
 * The sessions screen's verbs go through their declared descriptors (#526):
 * `sign-out-session` on each row and `sign-out-others` for the rest, each
 * asking in an `alertdialog` before it posts, and a refusal shown rather than
 * swallowed.
 */
test.beforeEach(() => {
  sessionVerbs.length = 0;
});

test('signing out the other sessions asks first, naming how many', async ({
  page,
}) => {
  await page.goto('/es/account/sessions');

  await page.getByRole('button', { name: 'Cerrar mis otras sesiones' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toHaveAccessibleName(
    '¿Cerrar mis otras sesiones (1 sesión)?',
  );
  // Cancel is where focus starts, and cancelling sends nothing.
  await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  expect(sessionVerbs).toEqual([]);

  await page.getByRole('button', { name: 'Cerrar mis otras sesiones' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Cerrar mis otras sesiones' })
    .click();

  await expect.poll(() => sessionVerbs).toEqual(['others']);
});

test('ending one session asks first, naming its device', async ({ page }) => {
  await page.goto('/es/account/sessions');

  await page.getByRole('button', { name: 'Cerrar esta sesión' }).last().click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toHaveAccessibleName(
    '¿Cerrar esta sesión Dispositivo desconocido?',
  );
  await dialog.getByRole('button', { name: 'Cerrar esta sesión' }).click();

  await expect.poll(() => sessionVerbs).toEqual(['session-2']);
});

test('a refused revocation says so', async ({ page, network }) => {
  network.use(
    http.post(`${APP_URL}/api/auth/sessions`, () =>
      HttpResponse.json(
        { type: 'about:blank', code: 'forbidden', status: 403 },
        {
          status: 403,
          headers: { 'content-type': 'application/problem+json' },
        },
      ),
    ),
  );
  await page.goto('/es/account/sessions');

  await page.getByRole('button', { name: 'Cerrar mis otras sesiones' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Cerrar mis otras sesiones' })
    .click();

  await expect(
    page.getByRole('alert').filter({
      hasText: 'No tienes permiso para realizar esta acción.',
    }),
  ).toBeVisible();
});
