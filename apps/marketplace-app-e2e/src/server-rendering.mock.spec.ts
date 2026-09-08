import {
  baseTest as test,
  expect,
} from '@r10c/entifix-ts-testing-e2e/playwright';

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
   * The cached routes must be served from the cache on a repeat visit. Without
   * this, everything above would still pass while every request silently
   * re-rendered — the failure mode a route table alone cannot catch.
   *
   * ⚠️ The first request is what *fills* that cache now. Nothing is enumerated
   * at build time any more — that would make `next build` fetch a service no
   * build machine has, and bake an empty catalog into the page — so every page
   * is rendered on its first request and cached from there.
   */
  test('serves the cached copy rather than re-rendering', async ({
    request,
  }) => {
    const responses = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      responses.push(await request.get('/es/p/offering-aurora-desk-lamp'));
    }

    // ⚠️ Three requests, and only the last one is pinned. An on-demand entry
    // fills in up to three steps — `MISS` renders it, `STALE` serves it while
    // the background regeneration runs, `HIT` serves the settled copy — and
    // where a given request lands depends on whether an earlier spec in the
    // run already visited this URL. What must hold either way is that repeat
    // visits are answered from the cache rather than re-rendered, so that is
    // what this asserts.
    expect(
      responses.map(response => response.headers()['x-nextjs-cache']),
    ).not.toContain('SKIP');
    expect(responses.at(-1)?.headers()['x-nextjs-cache']).toBe('HIT');
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
