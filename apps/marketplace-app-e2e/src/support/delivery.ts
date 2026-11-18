import type { Page } from '@playwright/test';

/**
 * Fills the review step's "Entrega y contacto" (ADR 0076 §2) the way a buyer
 * does: by the visible labels, and the municipio from its one grouped select.
 */
export const fillDelivery = async (page: Page) => {
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
