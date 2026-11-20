import { baseTest as test, expect } from '@entifix/testing-e2e/playwright';

/**
 * Browsing with scripting off (#730): home, a category, a search and a
 * seller's page list their products in the first response, and the header
 * names the categories on every page. Before, each listing and the header's
 * links sat in a streamed `Suspense` hole, which only a script reveals.
 */
test.describe('browsing without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('a visitor goes from home to a category, a seller and a product', async ({
    page,
  }) => {
    const catalog = () =>
      page
        .getByRole('navigation', { name: 'Catálogo' })
        .getByRole('link', { name: 'Iluminación' });

    await page.goto('/es');
    await expect(catalog()).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Lo más nuevo' }).getByRole('article'),
    ).toHaveCount(4);

    await catalog().click();
    await page.waitForURL(/\/es\/c\/lighting/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Iluminación' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Aurora Desk Lamp' }),
    ).toBeVisible();

    await page.goto('/es/search?q=aurora');
    await expect(catalog()).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Aurora Desk Lamp' }),
    ).toBeVisible();

    await page.getByRole('link', { name: 'Aurora Desk Lamp' }).click();
    await page.waitForURL(/\/es\/p\//);
    await page.getByTestId('seller').getByRole('link').click();
    await page.waitForURL(/\/es\/s\/demo-organization/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Demo Vendor' }),
    ).toBeVisible();
    await expect(catalog()).toBeVisible();

    await page.getByRole('link', { name: 'Aurora Desk Lamp' }).click();
    await page.waitForURL(/\/es\/p\//);
    await expect(
      page
        .getByRole('form', { name: 'Comprar' })
        .getByRole('button', { name: 'Añadir al carrito' }),
    ).toBeVisible();
  });
});

/** A seller's own page (#675): the link a seller shares with a customer. */
test.describe("a seller's page", () => {
  test('lists only that seller, and offers to share it and to chat', async ({
    page,
  }) => {
    await page.goto('/es/s/demo-organization');

    const cards = page.getByRole('article');
    await expect(cards.first()).toBeVisible();
    // The path chose the seller: no other seller's card, and no seller facet
    // offering one.
    await expect(page.getByText('Casa Solano')).toHaveCount(0);

    const share = page.getByTestId('seller-share');
    const href = new URL((await share.getAttribute('href')) ?? '');
    expect(href.origin + href.pathname).toBe('https://wa.me/');
    expect(href.searchParams.get('text')).toContain('/es/s/demo-organization');
    await expect(page.getByTestId('seller-chat')).toHaveAttribute(
      'href',
      /^https:\/\/wa\.me\/50255550100\?text=/,
    );

    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      'content',
      'Demo Vendor',
    );
  });

  test('a seller with no number offers no chat', async ({ page }) => {
    await page.goto('/es/s/vendor-casa-solano');
    await expect(page.getByTestId('seller-share')).toBeVisible();
    await expect(page.getByTestId('seller-chat')).toHaveCount(0);
  });

  test('an unknown seller answers 404', async ({ page }) => {
    const response = await page.goto('/es/s/no-such-vendor');
    expect(response?.status()).toBe(404);
  });
});
