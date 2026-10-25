import { baseTest as test, expect } from '@entifix/testing-e2e/playwright';

/**
 * The storefront's whole point is that a visitor — or a crawler, or a phone on
 * a bad connection — gets the product in the first response, before any
 * JavaScript runs.
 *
 * Every other spec asserts against the rendered DOM, which looks identical
 * whether the markup arrived in the document or was assembled by React in the
 * browser a second later. These assertions read the **raw response body**, so
 * they are the only ones that can tell the difference: a `'use client'` added
 * to a page root would leave the rest of the suite green and fail here.
 */

test.describe('server rendering', () => {
  test('ships the page copy in the document, not in a hydration payload', async ({
    request,
  }) => {
    const response = await request.get('/es');
    expect(response.status()).toBe(200);

    const html = await response.text();
    expect(html).toContain('Marketplace r10c');
    expect(html).toContain('Aurora Desk Lamp');
  });

  test('renders each locale from its own prerendered copy', async ({
    request,
  }) => {
    const [spanish, english] = await Promise.all([
      request.get('/es').then(r => r.text()),
      request.get('/en').then(r => r.text()),
    ]);

    expect(spanish).toContain('lang="es"');
    expect(spanish).toContain('Ver producto');
    expect(spanish).not.toContain('View product');

    expect(english).toContain('lang="en"');
    expect(english).toContain('View product');
    expect(english).not.toContain('Ver producto');
  });

  // A locale segment is a locale or it is nothing. `/de` is not a prefix the
  // proxy ever mints, so it is treated as an ordinary path: prefixed with
  // the negotiated locale, and then absent from the route tree.
  test('404s on a path that only looks like a locale', async ({ request }) => {
    const response = await request.get('/es/de');

    expect(response.status()).toBe(404);
  });

  test('a product page arrives complete, links resolved', async ({
    request,
  }) => {
    const html = await request
      .get('/es/p/offering-aurora-desk-lamp')
      .then(r => r.text());

    expect(html).toContain('Aurora Desk Lamp');
    // The snapshot carries `brandId` and `categoryId` — bare ids into
    // `catalog-reference`, another slice's store — so the page resolved both
    // through that domain's own read path. Names, never ids: rendering the id
    // is what this page used to do, and it read as a brand only because the
    // fixtures were named to look like one.
    expect(html).toContain('Aurora');
    expect(html).toContain('Lighting');
    // And the price, from the same snapshot. Stored in **minor units** and
    // rendered by `Intl` for the page's locale — so `1999` GTQ reads
    // `19,99 GTQ` in Spanish, comma and all. Asserting the dotted form here
    // would be asserting an English page.
    expect(html).toContain('19,99');
  });

  /**
   * The catalog routes must be served from a prerendered shell. Without this,
   * everything above would still pass while every request rendered the whole
   * page — the failure mode a route table alone cannot catch.
   *
   * Under Cache Components (#346) that is the shape a cached route has: a
   * static shell prerendered at build time, sent at once, with the catalog's
   * cached reads streamed into it (`x-nextjs-postponed`). It replaces the ISR
   * `x-nextjs-cache: HIT` this asserted before. Nothing from the catalog is in
   * the shell itself — a build machine has no fleet (ADR 0051) — which the
   * catalog's short cache lifetime guarantees.
   */
  test('serves each catalog route from its prerendered shell', async ({
    request,
  }) => {
    for (const path of [
      '/es',
      '/es/p/offering-aurora-desk-lamp',
      '/es/c/lighting',
      '/es/search',
    ]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      expect(response.headers()['x-nextjs-prerender'], path).toBe('1');
      expect(response.headers()['x-nextjs-postponed'], path).toBe('1');
    }
  });

  // The badge is the one thing a prerendered page cannot know. It must ship the
  // label with no count, and fill in only once the client has read the cookie.
  test('the static header ships a cart badge with no count', async ({
    request,
  }) => {
    const html = await request.get('/es').then(r => r.text());

    expect(html).toContain('data-testid="cart-badge"');
    expect(html).not.toContain('data-testid="cart-count"');
  });

  /**
   * #352: the shell is the same for everyone, and the count is streamed into
   * it. A visitor with three units in their cart gets the very shell an
   * anonymous one does — so it is served from the prerender, not rendered for
   * them — and the badge fills in once the client reads the cookie.
   */
  test('the badge is filled in over the shared static shell', async ({
    page,
    request,
    baseURL,
  }) => {
    const cookie = 'r10c_cart=offering-aurora-desk-lamp:3';
    const response = await request.get('/es', { headers: { cookie } });
    expect(response.headers()['x-nextjs-prerender']).toBe('1');
    expect(await response.text()).not.toContain('data-testid="cart-count"');

    await page.context().addCookies([
      {
        name: 'r10c_cart',
        value: 'offering-aurora-desk-lamp:3',
        url: baseURL ?? 'http://localhost:3000',
      },
    ]);
    await page.goto('/es');
    await expect(page.getByTestId('cart-count')).toHaveText('3');
  });
});
