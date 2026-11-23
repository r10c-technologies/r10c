import { AWAITING_LINK_ORDER_ID, expect, test } from './support/fixtures';

/**
 * A payment-link order waiting for its payment (ADR 0081): setting the link
 * and confirming the payment both carry a body, so the record's own region
 * asks for it and the generic verb buttons must not offer either — a header
 * button would post an empty body and answer a refusal the seller never
 * caused (entifix #315). Each verb is reachable exactly once, from its form.
 */
test('offers the payment verbs once, from the region that asks for their input', async ({
  page,
}) => {
  await page.goto(`/order/product-order/${AWAITING_LINK_ORDER_ID}`);

  const linkForm = page.getByTestId('order-payment-link-form');
  await expect(linkForm).toBeVisible();

  const setLink = page.getByRole('button', { name: 'Poner link de pago' });
  await expect(setLink).toHaveCount(1);
  await expect(
    linkForm.getByRole('button', { name: 'Poner link de pago' }),
  ).toBeVisible();

  const confirm = page.getByRole('button', { name: 'Confirmar pago' });
  await expect(confirm).toHaveCount(1);
});
