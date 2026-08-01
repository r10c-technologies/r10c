import { expect, test } from '@playwright/test';

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
  // middleware ever mints, so it is treated as an ordinary path: prefixed with
  // the negotiated locale, and then absent from the route tree.
  test('404s on a path that only looks like a locale', async ({ request }) => {
    const response = await request.get('/es/de');

    expect(response.status()).toBe(404);
  });

  test('a product page arrives complete, links resolved', async ({
    request,
  }) => {
    const html = await request.get('/es/p/AUR-LAMP-01').then(r => r.text());

    expect(html).toContain('Aurora Desk Lamp');
    // The brand travelled embedded in the payload…
    expect(html).toContain('Aurora');
    // …and the category as a bare id, which the link resolver followed. Both
    // arrive in the document, so neither costs the visitor a round trip.
    expect(html).toContain('Lighting');
  });

  /**
   * The prerendered routes must be served from the cache on a repeat visit.
   * Without this, everything above would still pass while every request
   * silently re-rendered — the failure mode a route table alone cannot catch.
   */
  test('serves the prerendered copy from cache on a second request', async ({
    request,
  }) => {
    await request.get('/es/p/AUR-LAMP-01');
    const second = await request.get('/es/p/AUR-LAMP-01');

    expect(second.headers()['x-nextjs-cache']).toBe('HIT');
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
});
