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

/**
 * A row a vendor scans (#556): the number, what was bought — the first
 * product, by the name it was sold under — and none of the ids that are always
 * the reader's own organization or mean nothing to them.
 */
test('reads an order row by its number and what was bought', async ({
  page,
}) => {
  await page.goto('/es/order/product-order');

  const row = page
    .locator(':is(tr, article):visible')
    .filter({ hasText: PAID_ORDER_NUMBER })
    .first();
  await expect(row).toContainText('Aurora Desk Lamp');
  await expect(row).not.toContainText('buyer-1');
  await expect(row).not.toContainText('group-1');
});
