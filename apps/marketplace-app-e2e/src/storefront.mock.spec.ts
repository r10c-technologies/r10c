import { baseTest as test, expect } from '@entifix/testing-e2e/playwright';

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
      page
        .getByRole('form', { name: 'Comprar' })
        .getByRole('button', { name: 'Añadir al carrito' }),
    ).toBeVisible();
  });

  test('home shows the category roots, the newest and the featured', async ({
    page,
  }) => {
    await page.goto('/es');

    const tiles = page.getByRole('region', { name: 'Categorías' });
    await expect(tiles.getByRole('link', { name: /Lighting/ })).toBeVisible();
    await expect(tiles.getByRole('link', { name: /Desk Lamps/ })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole('region', { name: 'Lo más nuevo' }).getByRole('article'),
    ).toHaveCount(4);
    // In stock only: the shop window leaves out what it cannot sell.
    await expect(
      page
        .getByRole('region', { name: 'Destacados' })
        .getByText('Sin existencias'),
    ).toHaveCount(0);
  });

  /**
   * #327: retiring takes a category out of browsing — and #346: its address
   * answers a real `404`, decided by the proxy before the static shell is sent.
   */
  test('a retired category is neither in the nav nor at its address', async ({
    page,
  }) => {
    await page.goto('/es');
    await expect(
      page
        .getByRole('navigation', { name: 'Catálogo' })
        .getByRole('link', { name: 'Lighting' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Archive' })).toHaveCount(0);

    const response = await page.goto('/es/c/archive');
    expect(response?.status()).toBe(404);
    await expect(page.locator('body')).not.toContainText('Archive');
  });

  /** #346: a miss is a real `404`, not the not-found page under a `200`. */
  test('an unknown product or category answers 404', async ({ page }) => {
    for (const path of ['/es/p/no-such-offering', '/en/c/no-such-category']) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        'content',
        /noindex/,
      );
    }
  });

  test('a category shows only its own products', async ({ page }) => {
    await page.goto('/es/c/lighting');

    await expect(page.getByText('Aurora Desk Lamp')).toBeVisible();
    await expect(page.getByText('Terra Ceramic Mug')).toHaveCount(0);
  });

  /**
   * ADR 0062: the desk lamp is classified under Desk Lamps, a child of
   * Lighting. Lighting lists it (the whole subtree), Desk Lamps lists only its
   * own, the header names the roots alone, and a category page offers its
   * children.
   */
  test('a category lists its subtree, and the nav its roots', async ({
    page,
  }) => {
    await page.goto('/es/c/lighting');
    await expect(page.getByText('Aurora Desk Lamp')).toBeVisible();
    await expect(page.getByText('Aurora Floor Lamp')).toBeVisible();
    await expect(
      page
        .getByRole('navigation', { name: 'Catálogo' })
        .getByRole('link', { name: 'Desk Lamps' }),
    ).toHaveCount(0);
    await expect(
      page
        .getByRole('navigation', { name: 'Subcategorías' })
        .getByRole('link', { name: 'Desk Lamps' }),
    ).toBeVisible();

    await page.goto('/es/c/desk-lamps');
    await expect(page.getByText('Aurora Desk Lamp')).toBeVisible();
    await expect(page.getByText('Aurora Floor Lamp')).toHaveCount(0);
  });

  /** #338: the trail runs home, then every ancestor, then the page itself. */
  test('a category three levels down shows its whole trail', async ({
    page,
  }) => {
    await page.goto('/es/c/task-lights');

    const trail = page.getByRole('navigation', { name: 'Ruta de navegación' });
    await expect(trail.getByRole('link', { name: 'Inicio' })).toHaveAttribute(
      'href',
      '/es',
    );
    await expect(trail.getByRole('link', { name: 'Lighting' })).toBeVisible();
    await expect(trail.getByRole('link', { name: 'Desk Lamps' })).toBeVisible();
    await expect(trail.getByText('Task Lights')).toHaveAttribute(
      'aria-current',
      'page',
    );
    // A leaf offers nothing to narrow into.
    await expect(
      page.getByRole('navigation', { name: 'Subcategorías' }),
    ).toHaveCount(0);
  });

  /** #337: the product page shows the vendor's pictures, thumbnails linked. */
  test('a product page shows its gallery and its trail', async ({ page }) => {
    await page.goto('/es/p/offering-cobalto-arc-lamp');

    const gallery = page.getByRole('region', {
      name: 'Imágenes del producto',
    });
    await expect(gallery.getByRole('link')).toHaveCount(3);
    await expect(
      gallery.getByRole('link', { name: 'Cobalto Arc Lamp, marble foot' }),
    ).toHaveAttribute('href', /^#/);
    const trail = page.getByRole('navigation', { name: 'Ruta de navegación' });
    await expect(trail.getByRole('link', { name: 'Lighting' })).toBeVisible();
    await expect(trail.getByText('Cobalto Arc Lamp')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  // Sorting is a link, not client state — so the URL is the whole mechanism and
  // the server renders the answer.
  /** #343: the seller line and the details, from three domains' reads. */
  test('a product page names its seller and its details', async ({ page }) => {
    await page.goto('/es/p/offering-cobalto-arc-lamp');

    await expect(page.getByTestId('seller')).toHaveText(
      'Vendido por Cobalto Studio',
    );
    const details = page.getByRole('definition');
    await expect(details).toContainText([
      'Cobalto',
      'Lighting',
      'COB-ARC-01',
      'Cobalto Studio',
    ]);
  });

  /** #347: a title, a canonical, every locale as an alternate, and JSON-LD. */
  test('a product page states its metadata', async ({ page }) => {
    await page.goto('/es/p/offering-cobalto-arc-lamp');

    await expect(page).toHaveTitle('Cobalto Arc Lamp · r10c · Marketplace');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      'http://localhost:3000/es/p/offering-cobalto-arc-lamp',
    );
    await expect(
      page.locator('link[rel="alternate"][hreflang="en"]'),
    ).toHaveAttribute(
      'href',
      'http://localhost:3000/en/p/offering-cobalto-arc-lamp',
    );

    const ld = JSON.parse(
      (await page
        .locator('script[type="application/ld+json"]')
        .textContent()) ?? '{}',
    );
    expect(ld).toMatchObject({
      '@type': 'Product',
      name: 'Cobalto Arc Lamp',
      sku: 'COB-ARC-01',
      brand: { name: 'Cobalto' },
      offers: {
        price: '189.00',
        priceCurrency: 'USD',
        availability: 'https://schema.org/InStock',
        seller: { name: 'Cobalto Studio' },
      },
    });
  });

  test('a listing is canonical without its filters', async ({ page }) => {
    await page.goto('/es/c/lighting?sort=newest&page=2');

    await expect(page).toHaveTitle('Lighting · r10c · Marketplace');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      'http://localhost:3000/es/c/lighting',
    );
  });

  test('sorting travels in the URL', async ({ page }) => {
    await page.goto('/es/c/lighting');
    await page.getByRole('link', { name: 'Precio: mayor a menor' }).click();

    await page.waitForURL(/sort=price-desc/);
    await expect(page).toHaveURL(/sort=price-desc/);
    await expect(
      page.getByRole('link', { name: 'Precio: mayor a menor' }),
    ).toHaveAttribute('aria-current', 'true');
    await expect(page.getByText('Aurora Desk Lamp')).toBeVisible();
  });

  // With no term, search lists the whole catalog (36 fixtures, 24 a page), so
  // the 25th result by name is on page 2 and reachable by a link.
  test('search pages through the whole catalog', async ({ page }) => {
    await page.goto('/es/search');
    await expect(page.getByText('36 productos')).toBeVisible();
    await expect(page.getByText('Solano Reading Light')).toHaveCount(0);

    await page
      .getByRole('navigation', { name: 'Páginas' })
      .getByRole('link', { name: '2', exact: true })
      .click();

    await page.waitForURL(/page=2/);
    await expect(page.getByText('Solano Reading Light')).toBeVisible();
  });

  test('a facet is a link that narrows the results', async ({ page }) => {
    await page.goto('/es/search');
    await page
      .getByRole('complementary', { name: 'Filtrar' })
      .getByRole('link', { name: 'Terra' })
      .click();

    await page.waitForURL(/brand=brand-terra/);
    await expect(page.getByText('6 productos')).toBeVisible();
    await expect(page.getByText('Terra Ceramic Mug')).toBeVisible();
    await expect(page.getByText('Aurora Desk Lamp')).toHaveCount(0);
  });

  test('the header searches from any page', async ({ page }) => {
    await page.goto('/es/c/lighting');
    await page.getByRole('searchbox').fill('mug');
    await page.getByRole('button', { name: 'Buscar' }).click();

    await page.waitForURL(/\/es\/search\?q=mug/);
    await expect(page.getByText('Terra Ceramic Mug')).toBeVisible();
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
    await page
      .getByRole('form', { name: 'Comprar' })
      .getByRole('button', { name: 'Añadir al carrito' })
      .click();

    // The action redirects here, which is the visitor's only feedback that it
    // worked — the header badge cannot update in place. Text is looked up in
    // the visible `main`: under Cache Components the product page navigated
    // away from stays in the DOM, hidden by React's `<Activity>`, and a bare
    // `getByText` finds it too. A role query skips what is hidden.
    await page.waitForURL(/\/es\/cart$/);
    await expect(page).toHaveURL(/\/es\/cart$/);
    await expect(
      page.getByRole('main').getByText('Aurora Desk Lamp'),
    ).toBeVisible();

    // The point of the cookie: a full reload still has it, because the server
    // rendered it — not because a client store rehydrated.
    await page.reload();
    await expect(
      page.getByRole('main').getByText('Aurora Desk Lamp'),
    ).toBeVisible();
  });

  /** #328: the cart states money, per line and in total, before checkout. */
  test('prices each line and totals the basket in money', async ({ page }) => {
    for (let added = 0; added < 2; added += 1) {
      await page.goto('/es/p/offering-aurora-desk-lamp');
      await page
        .getByRole('form', { name: 'Comprar' })
        .getByRole('button', { name: 'Añadir al carrito' })
        .click();
      await page.waitForURL(/\/es\/cart$/);
    }

    // 2 × 1999 minor units, in `es`'s separators. A count of units would read
    // "2".
    await expect(page.getByTestId('cart-line-price')).toContainText('39,98');
    await expect(page.getByTestId('cart-total')).toContainText('39,98');
  });

  test('the buy box adds the quantity it is given', async ({ page }) => {
    await page.goto('/es/p/offering-aurora-desk-lamp');
    const buy = page.getByRole('form', { name: 'Comprar' });
    await buy.getByRole('spinbutton', { name: 'Cantidad' }).fill('2');
    await buy.getByRole('button', { name: 'Añadir al carrito' }).click();

    await page.waitForURL(/\/es\/cart$/);
    await expect(page.getByTestId('cart-line-price')).toContainText('39,98');
  });

  test('a cart is kept out of search engines', async ({ page }) => {
    await page.goto('/es/cart');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    );
  });

  test('a card adds to the cart without opening the product', async ({
    page,
  }) => {
    await page.goto('/es');
    await page
      .getByRole('region', { name: 'Destacados' })
      .getByRole('article')
      .first()
      .getByRole('button', { name: 'Añadir al carrito' })
      .click();

    await page.waitForURL(/\/es\/cart$/);
    await expect(page.getByTestId('cart-line-price')).toHaveCount(1);
  });

  test('a quantity is changed in the cart, and zero removes the line', async ({
    page,
  }) => {
    await page.goto('/es/p/offering-aurora-desk-lamp');
    await page
      .getByRole('form', { name: 'Comprar' })
      .getByRole('button', { name: 'Añadir al carrito' })
      .click();
    await page.waitForURL(/\/es\/cart$/);

    await page.getByRole('spinbutton', { name: 'Cantidad' }).fill('3');
    await page.getByRole('button', { name: 'Actualizar' }).click();

    // 3 × 1999 minor units: the server re-rendered the line and the total.
    await expect(page.getByTestId('cart-line-price')).toContainText('59,97');
    await expect(page.getByTestId('cart-total')).toContainText('59,97');

    await page.getByRole('spinbutton', { name: 'Cantidad' }).fill('0');
    await page.getByRole('button', { name: 'Actualizar' }).click();
    await expect(page.getByText('Tu carrito está vacío.')).toBeVisible();
  });

  test('the header badge fills in from the cookie', async ({ page }) => {
    await page.goto('/es/p/offering-terra-ceramic-mug');
    await page
      .getByRole('form', { name: 'Comprar' })
      .getByRole('button', { name: 'Añadir al carrito' })
      .click();
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
    await page
      .getByRole('form', { name: 'Comprar' })
      .getByRole('button', { name: 'Añadir al carrito' })
      .click();
    await page.waitForURL(/\/es\/cart$/);

    await page.getByTestId('checkout').click();
    await page.waitForURL(/\/es\/order\/confirmation$/);

    // The address carries no order id: it is the same URL for everybody, and
    // the receipt travels in an httpOnly cookie.
    await expect(page).toHaveURL(/\/es\/order\/confirmation$/);
    await expect(page.getByTestId('order-id')).toContainText('e2e-order-1');
    await expect(
      page.getByRole('main').getByText('Aurora Desk Lamp'),
    ).toBeVisible();
    await expect(page.getByTestId('order-total')).toBeVisible();
  });

  test('the receipt survives a reload, and the cart is empty behind it', async ({
    page,
  }) => {
    await page.goto('/es/p/offering-aurora-desk-lamp');
    await page
      .getByRole('form', { name: 'Comprar' })
      .getByRole('button', { name: 'Añadir al carrito' })
      .click();
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
    await page
      .getByRole('form', { name: 'Comprar' })
      .getByRole('button', { name: 'Añadir al carrito' })
      .click();
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

  /**
   * #387: a cancel clicked before the order turned `paid` is "not yet", not
   * "never". The buyer is told to retry, and the button stays, because the
   * nonce was never spent.
   */
  test('a cancel that beats the payment confirmation asks the buyer to retry', async ({
    page,
  }) => {
    await page.goto('/es/p/offering-terra-ceramic-mug');
    await page
      .getByRole('form', { name: 'Comprar' })
      .getByRole('button', { name: 'Añadir al carrito' })
      .click();
    await page.waitForURL(/\/es\/cart$/);
    await page.getByTestId('checkout').click();
    await page.waitForURL(/\/es\/order\/confirmation$/);

    await page.getByRole('button', { name: 'Cancelar pedido' }).click();
    await page.waitForURL(/cancel=pending/);

    await expect(page.getByTestId('cancel-payment-pending')).toContainText(
      'todavía se está confirmando',
    );
    await expect(page.getByTestId('cancel-failed')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Cancelar pedido' }),
    ).toBeVisible();
  });

  test('a visitor with no receipt is told so rather than shown an error', async ({
    page,
  }) => {
    await page.goto('/es/order/confirmation');

    await expect(page.getByTestId('receipt-expired')).toBeVisible();
  });

  test('an item can be removed', async ({ page }) => {
    await page.goto('/es/p/offering-aurora-desk-lamp');
    await page
      .getByRole('form', { name: 'Comprar' })
      .getByRole('button', { name: 'Añadir al carrito' })
      .click();
    await page.waitForURL(/\/es\/cart$/);
    await expect(page).toHaveURL(/\/es\/cart$/);

    await page.getByRole('button', { name: 'Quitar' }).click();

    await expect(page.getByText('Tu carrito está vacío')).toBeVisible();
  });
});

test.describe('copy that counts', () => {
  // Found in the M10 live pass: a one-product listing read "1 productos".
  test('a count of one is singular, in both locales', async ({ page }) => {
    await page.goto('/es/search?q=Twine');
    await expect(page.getByText('1 producto', { exact: true })).toBeVisible();

    await page.goto('/en/search?q=Twine');
    await expect(page.getByText('1 product', { exact: true })).toBeVisible();
  });
});
