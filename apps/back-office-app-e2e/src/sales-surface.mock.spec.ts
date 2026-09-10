import { expect, test } from './support/fixtures';

/**
 * The selling surface: the channels a vendor authors, and the till they sell at.
 *
 * Mock-only, and for the shape of what is asserted rather than the data: these
 * journeys are about which tier each screen lands in and which affordances the
 * browser renders, and the served descriptor that decides the second is stubbed
 * verbatim in `fixtures.ts`. The service's half is `sales-service-e2e`, and the
 * sale itself is a live journey — a saga dispatched at a stubbed coordinator
 * would assert that a request can be composed and nothing about whether a sale
 * happened.
 */

test('files the channels under Definiciones and the till under Asistentes', async ({
  page,
}) => {
  await page.goto('/sales/sales-channel');

  // The tier is the sidebar's top level and comes from each section's own
  // `type`. A channel is defined and then referenced by every order placed
  // through it; selling is a guided act that ends (ADR 0033).
  await expect(
    page
      .getByRole('group', { name: 'Definiciones' })
      .getByRole('link', { name: 'Canales de venta', exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('group', { name: 'Asistentes' })
      .getByRole('link', { name: 'Vender en mostrador', exact: true }),
  ).toBeVisible();
});

test('lists the channels the vendor has, by name', async ({ page }) => {
  await page.goto('/sales/sales-channel');

  // Named rows rather than "a row exists": an assertion that some channel is
  // listed passes against a store the seed never touched.
  await expect(
    page.getByRole('cell', { name: 'Mostrador principal', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'Marketplace', exact: true }),
  ).toBeVisible();
});

test('offers Save on a channel, because a vendor authors it', async ({
  page,
}) => {
  // The mirror of the stock surface's read-only assertion, and it comes from
  // the same mechanism: the served descriptor reports `write`, so the generated
  // form offers Save. No client-side flag decides it either way (ADR 0026).
  await page.goto('/sales/sales-channel/sales-channel-counter');

  await expect(page.getByLabel('Nombre')).toHaveValue('Mostrador principal');
  await expect(page.getByRole('button', { name: 'Guardar' })).toBeVisible();
});

test('opens the till at its first step', async ({ page }) => {
  await page.goto('/sales/counter-sale');

  await expect(
    page.getByRole('combobox', { name: 'Canal' }),
  ).toBeVisible();
  // The flow may not advance until a channel is picked: the route refuses a
  // sale without one, so offering Continuar would be offering a dead end.
  await expect(page.getByRole('button', { name: 'Continuar' })).toBeDisabled();
});

test('addresses a channel tab as a definition', async ({ page }) => {
  await page.goto('/workspace?tab=master:sales-channel');

  await expect(
    page.getByRole('cell', { name: 'Mostrador principal', exact: true }),
  ).toBeVisible();
});

test('addresses the till as a wizard', async ({ page }) => {
  // `wizard:counter-sale`, not `master:` — the address is the taxonomy
  // serialized, so a lie here is one the registry then has to keep (ADR 0042).
  await page.goto('/workspace?tab=wizard:counter-sale');

  await expect(page.getByRole('combobox', { name: 'Canal' })).toBeVisible();
});
