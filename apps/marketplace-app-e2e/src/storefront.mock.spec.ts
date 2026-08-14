import {
  baseTest as test,
  expect,
} from '@r10c/entifix-ts-testing-e2e/playwright';

/**
 * The storefront's journeys, walked the way a visitor walks them.
 *
 * Deliberately click-driven rather than URL-driven: typing `/es/p/AUR-LAMP-01`
 * would prove the page renders, but not that anything links to it. A catalog
 * whose products are unreachable still passes every route test.
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
    await page.goto('/es/p/AUR-LAMP-01');
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
    await page.goto('/es/p/TER-MUG-01');
    await page.getByRole('button', { name: 'Añadir al carrito' }).click();
    await page.waitForURL(/\/es\/cart$/);
    await expect(page).toHaveURL(/\/es\/cart$/);

    // Home is prerendered, so its HTML carries no count at all — the island
    // fills it in from the cookie once it mounts.
    await page.goto('/es');
    await expect(page.getByTestId('cart-count')).toHaveText('1');
  });

  test('an item can be removed', async ({ page }) => {
    await page.goto('/es/p/AUR-LAMP-01');
    await page.getByRole('button', { name: 'Añadir al carrito' }).click();
    await page.waitForURL(/\/es\/cart$/);
    await expect(page).toHaveURL(/\/es\/cart$/);

    await page.getByRole('button', { name: 'Quitar' }).click();

    await expect(page.getByText('Tu carrito está vacío')).toBeVisible();
  });
});
