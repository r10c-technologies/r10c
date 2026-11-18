import {
  expect,
  PAID_ORDER_ID,
  PAID_ORDER_NUMBER,
  test,
} from './support/fixtures';

/**
 * An order is called by its number (ADR 0076 §5, #577): `labelMember` makes it
 * the row's link and the record's breadcrumb, so a vendor reads out to a buyer
 * exactly what the buyer's receipt says, and never a UUID.
 */
test('names an order by its number in the list and on its own page', async ({
  page,
}) => {
  await page.goto('/es/order/product-order');
  const link = page.getByRole('link', { name: PAID_ORDER_NUMBER });
  await expect(link).toBeVisible();

  await link.click();
  await expect(page).toHaveURL(
    new RegExp(`/order/product-order/${PAID_ORDER_ID}`),
  );
  // The breadcrumb's last crumb is the record's own name.
  await expect(
    page
      .getByRole('navigation', { name: /ruta|breadcrumb/i })
      .getByRole('listitem')
      .last(),
  ).toHaveText(PAID_ORDER_NUMBER);
});
