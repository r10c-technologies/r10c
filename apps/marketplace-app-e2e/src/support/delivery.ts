import type { Page } from '@playwright/test';

/**
 * Chooses how to pay each seller who takes more than one tender (ADR 0076 §7):
 * the one named in `tenders`, or a card. A seller who takes one tender has no
 * control to choose, and nothing is checked in advance.
 */
export const chooseTenders = async (
  page: Page,
  tenders: Readonly<Record<string, 'card' | 'cod'>> = {},
) => {
  const form = page.getByTestId('delivery-form').filter({ visible: true });
  // The review body streams in: wait for the form before reading its groups,
  // or a list taken too early is empty and nothing gets chosen.
  await form.getByTestId('checkout').waitFor();
  const radios = form.locator('input[type="radio"][value="card"]');
  for (const radio of await radios.all()) {
    const testId = (await radio.getAttribute('data-testid')) ?? '';
    const vendorId = testId.replace(/^payment-/, '').replace(/-card$/, '');
    await form
      .getByTestId(`payment-${vendorId}-${tenders[vendorId] ?? 'card'}`)
      .check();
  }
};

/**
 * Fills the review step's "Entrega y contacto" (ADR 0076 §2) the way a buyer
 * does — by the visible labels, and the municipio from its one grouped select
 * — after choosing how to pay each seller.
 */
export const fillDelivery = async (
  page: Page,
  tenders: Readonly<Record<string, 'card' | 'cod'>> = {},
) => {
  await chooseTenders(page, tenders);
  const form = page.getByTestId('delivery-form').filter({ visible: true });
  await form
    .getByLabel('Nombre de quien recibe', { exact: true })
    .fill('Ana López');
  await form.getByLabel('Teléfono', { exact: true }).fill('5555-1234');
  await form
    .getByLabel('Correo electrónico', { exact: true })
    .fill('ana@correo.com');
  await form.getByLabel('Municipio', { exact: true }).selectOption('0108');
  await form.getByLabel('Dirección', { exact: true }).fill('5a avenida 12-34');
};
