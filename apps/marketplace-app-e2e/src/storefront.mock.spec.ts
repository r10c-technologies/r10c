import {
  baseTest as test,
  expect,
} from '@r10c/entifix-ts-testing-e2e/playwright';

/**
 * The storefront's journeys, walked the way a visitor walks them.
 *
 * Deliberately click-driven rather than URL-driven: typing
 * `/es/p/offering-aurora-desk-lamp` would prove the page renders, but not that
 * anything links to it. A catalog whose products are unreachable still passes
 * every route test.
 *
 * ⚠️ The data behind these is served by msw **inside the Next process**
 * (`support/server-mocks.mjs`), because every read here happens in a server
 * component. Before the storefront read a real backend these names came from a
 * fixture module the app imported; they now travel over the wire, through the
 * real REST adapters and the real query pipeline.
 */

test.describe('browsing the catalog', () => {
  test('home lists featured products and links to one', async ({ page }) => {
    await page.goto('/es');

    await expect(
      page.getByRole('heading', { name: 'Marketplace r10c' }),
    ).toBeVisible();

    await page.getByRole('link', { name: 'Ver producto' }).first().click();

    // Wait for the navigation, then assert the URL. Every click here is a full
    // server navigation, and `toHaveURL` polls on the 5s *expect* timeout — a
    // dynamic render that outlives it fails the spec for no reason of its own.
    // `waitForURL` waits on the navigation timeout instead.
    await page.waitForURL(/\/es\/p\//);
    await expect(page).toHaveURL(/\/es\/p\//);
    await expect(
      page.getByRole('button', { name: 'Añadir al carrito' }),
    ).toBeVisible();
  });

  test('a category shows only its own products', async ({ page }) => {
    await page.goto('/es/c/lighting');

    await expect(page.getByText('Aurora Desk Lamp')).toBeVisible();
    await expect(page.getByText('Terra Ceramic Mug')).toHaveCount(0);
  });

  // Sorting is a link, not client state — so the URL is the whole mechanism and
  // the server renders the answer.
  test('sorting travels in the URL', async ({ page }) => {
    await page.goto('/es/c/lighting');
    await page.getByRole('link', { name: 'Referencia' }).click();

    await page.waitForURL(/sort=code/);
    await expect(page).toHaveURL(/sort=code/);
    await expect(page.getByText('Aurora Desk Lamp')).toBeVisible();
  });

  test('search renders its results on the server', async ({ page }) => {
    await page.goto('/es/search');
    await page.getByRole('searchbox').fill('mug');
    await page.getByRole('button', { name: 'Buscar' }).click();

    await page.waitForURL(/q=mug/);
    await expect(page).toHaveURL(/q=mug/);
    await expect(page.getByText('Terra Ceramic Mug')).toBeVisible();
    await expect(page.getByText('Aurora Desk Lamp')).toHaveCount(0);
  });
});

test.describe('the cart', () => {
  /**
   * The point of the cookie: after a **full reload** the cart is still there,
   * because the server rendered it — not because a client store rehydrated.
   */
  test('survives a reload because the server renders it', async ({ page }) => {
    await page.goto('/es/p/offering-aurora-desk-lamp');
    await page.getByRole('button', { name: 'Añadir al carrito' }).click();

    // The action redirects here, which is the visitor's only feedback that it
    // worked — the header badge cannot update in place.
    await page.waitForURL(/\/es\/cart$/);
    await expect(page).toHaveURL(/\/es\/cart$/);
    await expect(page.getByText('Aurora Desk Lamp')).toBeVisible();

    // The point of the cookie: a full reload still has it, because the server
    // rendered it — not because a client store rehydrated.
    await page.reload();
    await expect(page.getByText('Aurora Desk Lamp')).toBeVisible();
  });

  test('the header badge fills in from the cookie', async ({ page }) => {
    await page.goto('/es/p/offering-terra-ceramic-mug');
    await page.getByRole('button', { name: 'Añadir al carrito' }).click();
    await page.waitForURL(/\/es\/cart$/);
    await expect(page).toHaveURL(/\/es\/cart$/);

    // Home is prerendered, so its HTML carries no count at all — the island
    // fills it in from the cookie once it mounts.
    await page.goto('/es');
    await expect(page.getByTestId('cart-count')).toHaveText('1');
  });

  /**
   * The whole point of #235: a placed order is a receipt the buyer can read,
   * not a banner over an emptied cart.
   *
   * ⚠️ The coordinator is stubbed **inside the Next process**: the checkout is a
   * server action, so a `page.route()` interceptor would never see the call.
   */
  test('a checkout lands on a receipt that names the order', async ({
    page,
  }) => {
    await page.goto('/es/p/offering-aurora-desk-lamp');
    await page.getByRole('button', { name: 'Añadir al carrito' }).click();
    await page.waitForURL(/\/es\/cart$/);

    await page.getByTestId('checkout').click();
    await page.waitForURL(/\/es\/order\/confirmation$/);

    // The address carries no order id: it is the same URL for everybody, and
    // the receipt travels in an httpOnly cookie.
    await expect(page).toHaveURL(/\/es\/order\/confirmation$/);
    await expect(page.getByTestId('order-id')).toContainText('e2e-order-1');
    await expect(page.getByText('Aurora Desk Lamp')).toBeVisible();
    await expect(page.getByTestId('order-total')).toBeVisible();
  });

  test('the receipt survives a reload, and the cart is empty behind it', async ({
    page,
  }) => {
    await page.goto('/es/p/offering-aurora-desk-lamp');
    await page.getByRole('button', { name: 'Añadir al carrito' }).click();
    await page.waitForURL(/\/es\/cart$/);
    await page.getByTestId('checkout').click();
    await page.waitForURL(/\/es\/order\/confirmation$/);

    await page.reload();
    await expect(page.getByTestId('order-id')).toContainText('e2e-order-1');

    // ⚠️ The cart was cleared on the path it was written with. Expiring it on
    // another path leaves the original cookie in place, and the basket comes
    // back on the next request.
    await page.goto('/es/cart');
    await expect(page.getByText('Tu carrito está vacío')).toBeVisible();
  });

  /**
   * ⚠️ **The affordance and the window are one decision, and this is the half a
   * unit test cannot show.** The receipt carries the nonce and the moment the
   * server stamped; the page offers the button only while both hold. The
   * alternative the rule exists to prevent is a button that is always drawn and
   * a `401` as the only explanation for it (ADR 0058 §5).
   */
  test('a receipt with a live window offers the buyer their own cancel', async ({
    page,
  }) => {
    await page.goto('/es/p/offering-aurora-desk-lamp');
    await page.getByRole('button', { name: 'Añadir al carrito' }).click();
    await page.waitForURL(/\/es\/cart$/);
    await page.getByTestId('checkout').click();
    await page.waitForURL(/\/es\/order\/confirmation$/);

    // The window is *named*, rather than left for the button to stop working on
    // its own at a moment the buyer was never told about.
    await expect(page.getByTestId('cancel-window')).toBeVisible();

    await page.getByRole('button', { name: 'Cancelar pedido' }).click();
    await page.waitForURL(/cancel=cancelled/);

    // Rendered from what the cancel answered, not from a re-read: the
    // storefront holds no session and this page reads nothing back.
    await expect(page.getByTestId('order-placed')).toContainText('Cancelamos');
    // The capability is spent, so the button is gone — and the order reference
    // stays, because a cancelled order is still the buyer's receipt.
    await expect(
      page.getByRole('button', { name: 'Cancelar pedido' }),
    ).toHaveCount(0);
    await expect(page.getByTestId('order-id')).toContainText('e2e-order-1');
  });

  test('a visitor with no receipt is told so rather than shown an error', async ({
    page,
  }) => {
    await page.goto('/es/order/confirmation');

    await expect(page.getByTestId('receipt-expired')).toBeVisible();
  });

  test('an item can be removed', async ({ page }) => {
    await page.goto('/es/p/offering-aurora-desk-lamp');
    await page.getByRole('button', { name: 'Añadir al carrito' }).click();
    await page.waitForURL(/\/es\/cart$/);
    await expect(page).toHaveURL(/\/es\/cart$/);

    await page.getByRole('button', { name: 'Quitar' }).click();

    await expect(page.getByText('Tu carrito está vacío')).toBeVisible();
  });
});
