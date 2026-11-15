import {
  expect,
  ringUps,
  salesChannelBackend,
  test,
  TILL_FLOW_ID,
} from './support/fixtures';
import { scriptStream } from './support/flow-stream';
import { salesChannelSeed } from './support/sales-seed';

/**
 * The selling surface: the channels a vendor authors, and the till they sell at.
 *
 * Mock-only, and for the shape of what is asserted rather than the data: these
 * journeys are about which tier each screen lands in and which affordances the
 * browser renders, and the served descriptor that decides the second is stubbed
 * verbatim in `fixtures.ts`. The service's half is `sales-service-e2e`, and the
 * sale itself is a live journey — a saga dispatched at a stubbed coordinator
 * would assert that a request can be composed and nothing about whether a sale
 * happened. What this file asserts of the till is which endpoint it reaches.
 */

test.beforeEach(() => {
  // One journey below sells as a vendor with a single channel; every other
  // starts from the two the seed declares.
  salesChannelBackend.seed(salesChannelSeed);
});

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

test('opens the till at its first step, with a channel already chosen', async ({
  page,
}) => {
  await page.goto('/sales/counter-sale');

  // Two channels are a row of buttons, and a row of buttons always shows one
  // as chosen — so the till chooses it, and the one it shows is the one the
  // sale would use.
  const channel = page.getByRole('radiogroup', { name: 'Canal' });
  await expect(channel).toBeVisible();
  await expect(
    channel.getByRole('radio', { name: 'Marketplace' }),
  ).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('button', { name: 'Continuar' })).toBeEnabled();
});

test('a vendor with one channel sells without touching a channel control', async ({
  page,
  network,
}) => {
  salesChannelBackend.seed(
    salesChannelSeed.filter(channel => channel.id === 'sales-channel-counter'),
  );
  const checkout = scriptStream(network, TILL_FLOW_ID);
  await page.goto('/sales/counter-sale');

  // The till opens on the lines: the one answer the channel step could take is
  // already given.
  await page
    .getByRole('combobox', { name: 'Producto' })
    .selectOption('product-offering-1');
  await expect(page.getByRole('radiogroup', { name: 'Canal' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Agregar producto' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();

  // The skipped answer is shown before money is taken.
  await expect(page.getByText('Canal: Mostrador principal')).toBeVisible();
  await page.getByRole('button', { name: /Finalizar/ }).click();
  checkout.outcome = 'flow.completed';
  await expect(page.getByText('Venta registrada')).toBeVisible();
  expect(ringUps.at(-1)?.url).toBe(
    '/api/sales/sales-channel/sales-channel-counter/sell',
  );
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

  await expect(page.getByRole('radiogroup', { name: 'Canal' })).toBeVisible();
});

test('rings up a sale through the channel’s own sell verb, and waits on its checkout', async ({
  page,
  network,
}) => {
  const checkout = scriptStream(network, TILL_FLOW_ID);
  await page.goto('/sales/counter-sale');

  await page
    .getByRole('radiogroup', { name: 'Canal' })
    .getByRole('radio', { name: 'Mostrador principal' })
    .click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page
    .getByRole('combobox', { name: 'Producto' })
    .selectOption('product-offering-1');
  await page.getByRole('button', { name: 'Agregar producto' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  // Tender codes are copy: no wire value reaches a Spanish-speaking cashier.
  const tender = page.getByRole('combobox', { name: 'Forma de pago' });
  await expect(tender.getByRole('option', { name: 'Efectivo' })).toBeAttached();
  await expect(tender).not.toContainText(/\b(cash|card|voucher|transfer)\b/);
  await page.getByRole('button', { name: 'Continuar' }).click();
  // 6499 minor units is 64,99 quetzales, never "6499 GTQ" (#524).
  await expect(page.getByText(/Total: 64,99\sGTQ/)).toBeVisible();
  await page.getByRole('button', { name: /Finalizar/ }).click();

  // Accepted is not sold: the till waits until the checkout completes.
  await expect(page.getByText('Venta registrada')).toHaveCount(0);
  checkout.outcome = 'flow.completed';
  await expect(page.getByText('Venta registrada')).toBeVisible();
  // The verb bound to the channel, under a key so a retried charge is one
  // checkout — and a body with no price in it, because the service re-prices.
  const sale = ringUps.at(-1);
  expect(sale?.url).toBe('/api/sales/sales-channel/sales-channel-counter/sell');
  expect(sale?.idempotencyKey).toMatch(/^".+"$/);
  expect(sale?.body).toEqual({
    paymentMethod: 'cash',
    lines: [{ offeringId: 'product-offering-1', quantity: 1 }],
  });
});
