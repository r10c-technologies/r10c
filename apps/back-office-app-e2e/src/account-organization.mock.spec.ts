import { expect, test } from './support/fixtures';

/**
 * The organization's fiscal identity (ADR 0078 §6): the form opens on what
 * auth-service holds and saves through a server action, so it posts with or
 * without script, and says so once it has.
 */
test('saves the fiscal identity, and opens on it next time', async ({
  page,
}) => {
  await page.goto('/es/account/organization');

  await expect(
    page.getByRole('heading', { name: 'Datos fiscales', level: 1 }),
  ).toBeVisible();
  const legalName = page.getByRole('textbox', { name: 'Razón social' });
  await expect(legalName).toHaveValue('Tienda Demo, S.A.');
  await expect(page.getByRole('textbox', { name: 'NIT' })).toHaveValue(
    '10000003',
  );

  await legalName.fill('Tienda Demo Renombrada, S.A.');
  await page.getByRole('button', { name: 'Guardar datos fiscales' }).click();

  await expect(
    page.getByText(
      'Datos fiscales guardados. Los pedidos nuevos los usan desde ahora.',
    ),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Razón social' })).toHaveValue(
    'Tienda Demo Renombrada, S.A.',
  );
});

/**
 * Whether the organization takes payment links (ADR 0081 §1): its own form
 * beside the fiscal one, saved through a server action and read back on the
 * next visit.
 */
test('switches payment links on, and opens on it next time', async ({
  page,
}) => {
  await page.goto('/es/account/organization');

  const accepts = page.getByRole('checkbox', {
    name: 'Acepto pagos con un enlace que envío',
  });
  await expect(accepts).not.toBeChecked();

  await accepts.check();
  await page.getByRole('button', { name: 'Guardar enlaces de pago' }).click();
  await expect(
    page.getByText('Guardado. Las compras nuevas lo siguen desde ahora.'),
  ).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole('checkbox', {
      name: 'Acepto pagos con un enlace que envío',
    }),
  ).toBeChecked();
});

/**
 * The WhatsApp number buyers may write to (#671) is the organization's own to
 * state, and the form opens on it next visit, as stored.
 */
test('saves the WhatsApp number, and opens on it next time', async ({
  page,
}) => {
  await page.goto('/es/account/organization');

  const number = page.getByRole('textbox', { name: 'WhatsApp' });
  await expect(number).toHaveValue('');

  await number.fill('5555-1234');
  await page.getByRole('button', { name: 'Guardar WhatsApp' }).click();
  await expect(
    page.getByText('Guardado. Los recibos ofrecen el chat desde ahora.'),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByRole('textbox', { name: 'WhatsApp' })).toHaveValue(
    '+50255551234',
  );
});
