import {
  baseTest as test,
  expect,
  requireLiveUrl,
} from '@entifix/testing-e2e/playwright';

import {
  listedUnder,
  PUBLISHED_OFFERINGS,
  SEARCH_HIT,
  SEARCH_MISS,
  UNPUBLISHED_OFFERING,
} from './support/live-seed';

/**
 * The storefront against the real fleet.
 *
 * ⚠️ This suite is why deleting the fixture repository is not a cosmetic
 * change. Every other storefront spec is `*.mock.spec.ts`, and `mock` fakes
 * marketplace-service **inside the Next process** — so a storefront that read
 * nothing real would pass all of them, and would go on passing after the
 * fixtures it used to read were removed. Only a live run can tell the
 * difference between "the page renders" and "the page renders what a vendor
 * published".
 *
 * What it needs behind it: marketplace-service serving `published-catalog` and
 * `catalog-reference`, and a `published-catalog` that has actually been filled.
 * On a fresh lab that is ADR 0050's rebuild walk, which runs in
 * **marketplace-admin-service** — hence that service in `marketplace-app:dev`'s
 * `dependsOn`. Without it the seed's `published` offerings are never announced,
 * the projection stays empty, and every assertion below would be asserting
 * against nothing.
 *
 * ```sh
 * pnpm run mp:dev:reset          # in another terminal, and wait for it
 * E2E_PROFILE=live MARKETPLACE_SERVICE_URL=http://localhost:3100 \
 *   pnpm nx e2e marketplace-app-e2e
 * ```
 *
 * The expectations come from `support/live-seed.ts`, which restates the fleet
 * seed's generation rules rather than importing them — the convention
 * `back-office-app-e2e` already follows, and the reason a seed change that
 * nobody mirrored fails here instead of being absorbed.
 */

const SERVICE_URL = requireLiveUrl('MARKETPLACE_SERVICE_URL');

/**
 * The precondition, asserted rather than assumed.
 *
 * An empty projection renders the storefront's own "nothing here yet" copy, and
 * `loadPage` deliberately never rejects — so a fleet whose publications never
 * arrived produces a storefront that looks *finished and quiet*. Asking the
 * service directly, before any page is opened, is what separates "the catalog
 * is empty" from "the catalog is broken"; without it every journey below could
 * pass for the wrong reason.
 */
test.describe('the seeded fleet', () => {
  test('has the seed’s publications in `published-catalog`', async ({
    request,
  }) => {
    const response = await request.get(
      `${SERVICE_URL}/api/published-offering?pageSize=100`,
    );
    expect(response.status()).toBe(200);

    const body = (await response.json()) as {
      data: { items: Array<{ offeringId: string }> };
    };
    const ids = body.data.items.map(item => item.offeringId);

    for (const offering of PUBLISHED_OFFERINGS) {
      expect(ids).toContain(offering.offeringId);
    }
    // And nothing that was never announced. The projection is a projection of
    // what publishing emitted, not a copy of tenant storage — a draft reaching
    // it means the rebuild walk announced a record it must not have.
    expect(ids).not.toContain(UNPUBLISHED_OFFERING.offeringId);
  });
});

/** The published offering a card names, by the name its heading shows. */
const seededByName = (name: string) => {
  const found = PUBLISHED_OFFERINGS.find(offering => offering.name === name);
  if (found === undefined) {
    throw new Error(`"${name}" is on the storefront but not in the live seed`);
  }
  return found;
};

/** A seller's display name, asked of the projection rather than restated. */
const sellerOf = async (
  request: import('@playwright/test').APIRequestContext,
  offeringId: string,
): Promise<string | undefined> => {
  const offering = (await (
    await request.get(
      `${SERVICE_URL}/api/published-offering?rsql=${encodeURIComponent(`offeringId==${offeringId}`)}`,
    )
  ).json()) as { data: { items: Array<{ vendorId: string }> } };
  const vendorId = offering.data.items[0]?.vendorId;
  if (vendorId === undefined) return undefined;
  const vendor = (await (
    await request.get(
      `${SERVICE_URL}/api/published-vendor?rsql=${encodeURIComponent(`vendorId==${vendorId}`)}`,
    )
  ).json()) as { data: { items: Array<{ displayName: string }> } };
  return vendor.data.items[0]?.displayName;
};

test.describe('browsing the published catalog', () => {
  test('home shows the category roots, the newest and the featured', async ({
    page,
  }) => {
    await page.goto('/es');

    await expect(
      page.getByRole('heading', { name: 'Marketplace r10c' }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Categorías' }).getByRole('link'),
    ).not.toHaveCount(0);
    // Four, because each strip asks for four — the real service's paging
    // answering, not the whole projection rendered.
    await expect(
      page.getByRole('region', { name: 'Lo más nuevo' }).getByRole('article'),
    ).toHaveCount(4);
    const featured = page.getByRole('region', { name: 'Destacados' });
    await expect(featured.getByRole('article').first()).toBeVisible();
    // In stock only: the shop window leaves out what it cannot sell.
    await expect(featured.getByText('Sin existencias')).toHaveCount(0);
  });

  /**
   * Click-driven rather than URL-driven: typing the address would prove the
   * page renders, not that anything links to it. A catalog whose products are
   * unreachable still passes every route test.
   */
  test('a featured card leads to its offering, with its details and seller', async ({
    page,
    request,
  }) => {
    await page.goto('/es');
    const card = page
      .getByRole('region', { name: 'Destacados' })
      .getByRole('article')
      .first();
    const offering = seededByName(await card.getByRole('heading').innerText());

    await card.getByRole('link', { name: 'Ver producto' }).click();
    await page.waitForURL(`**/es/p/${offering.offeringId}`);

    await expect(
      page.getByRole('main').getByRole('heading', { level: 1 }),
    ).toHaveText(offering.name);
    // The brand and the category are **names**, resolved out of
    // `catalog-reference` — a different store, reached through its own read
    // path. The snapshot carries only their ids, so a page rendering these
    // proves both reads happened.
    await expect(page.getByRole('definition')).toContainText([
      offering.brandName,
      offering.categoryName,
      offering.code,
    ]);
    // Minor units, rendered by `Intl` for this locale: the separator is the
    // assertion, since a page that skipped the formatter would show `8499`.
    await expect(page.getByRole('main')).toContainText(
      (offering.amount / 100).toFixed(2).replace('.', ','),
    );
    // The seller's name is a projection of their organization (ADR 0061),
    // announced by auth-service — asked of the service, not restated.
    const seller = await sellerOf(request, offering.offeringId);
    expect(seller, 'the seeded vendor was announced').toBeDefined();
    await expect(page.getByTestId('seller')).toHaveText(
      `Vendido por ${seller}`,
    );
  });

  test('a product page states its metadata', async ({ page }) => {
    const offering = PUBLISHED_OFFERINGS[0];
    await page.goto(`/es/p/${offering.offeringId}`);

    await expect(page).toHaveTitle(`${offering.name} · r10c · Marketplace`);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      new RegExp(`/es/p/${offering.offeringId}$`),
    );
    const ld = JSON.parse(
      (await page
        .locator('script[type="application/ld+json"]')
        .textContent()) ?? '{}',
    );
    expect(ld).toMatchObject({
      '@type': 'Product',
      name: offering.name,
      sku: offering.code,
      offers: {
        price: (offering.amount / 100).toFixed(2),
        priceCurrency: offering.currency,
      },
    });
  });

  test('a category lists only what was published into it', async ({ page }) => {
    const offering = PUBLISHED_OFFERINGS[0];
    // Its own category's offerings and its active children's (ADR 0062).
    const siblings = listedUnder(offering.categoryNumber);

    await page.goto(`/es/c/${offering.categoryCode}`);

    await expect(
      page.getByRole('main').getByRole('heading', { level: 1 }),
    ).toHaveText(offering.categoryName);
    await expect(page.getByRole('main').getByRole('article')).toHaveCount(
      siblings.length,
    );
  });

  test('a brand facet narrows the results to that brand', async ({ page }) => {
    const offering = PUBLISHED_OFFERINGS[0];
    const sameBrand = PUBLISHED_OFFERINGS.filter(
      each => each.brandName === offering.brandName,
    );

    await page.goto('/es/search');
    await page
      .getByRole('complementary', { name: 'Filtrar' })
      .getByRole('link', { name: offering.brandName, exact: true })
      .click();

    await page.waitForURL(/brand=/);
    await expect(page.getByRole('main').getByRole('article')).toHaveCount(
      sameBrand.length,
    );
  });

  test('sorting by price puts the cheapest publication first', async ({
    page,
  }) => {
    const cheapest = [...PUBLISHED_OFFERINGS].sort(
      (left, right) => left.amount - right.amount,
    )[0];

    await page.goto('/es/search?sort=price-asc');
    await expect(
      page.getByRole('main').getByRole('article').first().getByRole('heading'),
    ).toHaveText(cheapest.name);
  });

  test('search finds every published offering a term names', async ({
    page,
  }) => {
    await page.goto('/es/search');
    await page.getByRole('searchbox').fill(SEARCH_HIT.family);
    await page.getByRole('button', { name: 'Buscar' }).click();

    await page.waitForURL(new RegExp(`q=${SEARCH_HIT.family}`));

    for (const offering of SEARCH_HIT.published) {
      await expect(
        page.getByRole('main').getByRole('heading', { name: offering.name }),
      ).toBeVisible();
    }
    await expect(page.getByRole('main').getByRole('article')).toHaveCount(
      SEARCH_HIT.published.length,
    );
  });

  test('the buy box carries its quantity into the cart', async ({ page }) => {
    const offering = PUBLISHED_OFFERINGS[0];
    await page.goto(`/es/p/${offering.offeringId}`);

    const buy = page.getByRole('form', { name: 'Comprar' });
    await buy.getByRole('spinbutton', { name: 'Cantidad' }).fill('2');
    await buy.getByRole('button', { name: 'Añadir al carrito' }).click();

    await page.waitForURL(/\/es\/cart$/);
    await expect(page.getByTestId('cart-line-price')).toContainText(
      ((offering.amount * 2) / 100).toFixed(2).replace('.', ','),
    );
  });
});

/**
 * The half that proves *which store* is being read.
 *
 * Both of these name records that exist — as specifications and offerings in
 * `tenant_<id>` — and were never announced. A storefront reading tenant storage
 * would answer them; one reading the projection cannot.
 */
test.describe('what was never published', () => {
  test('a term matching only unpublished offerings finds nothing', async ({
    page,
  }) => {
    await page.goto(`/es/search?q=${encodeURIComponent(SEARCH_MISS.family)}`);

    await expect(
      page.getByText(`No encontramos nada para «${SEARCH_MISS.family}».`),
    ).toBeVisible();
  });

  test('an unknown category answers 404', async ({ page }) => {
    const response = await page.goto('/es/c/no-such-category');
    expect(response?.status()).toBe(404);
  });

  test('a draft offering has no page, even at its own address', async ({
    page,
  }) => {
    const response = await page.goto(
      `/es/p/${UNPUBLISHED_OFFERING.offeringId}`,
    );

    // A real `404` since #346: the proxy finds no publication and answers
    // before the route's static shell is sent. The 200 ADR 0051 measured was
    // a `loading.tsx` streaming ahead of `notFound()`, not the shell layer.
    expect(response?.status()).toBe(404);
    await expect(page.locator('body')).not.toContainText(
      UNPUBLISHED_OFFERING.name,
    );
    await expect(
      page
        .getByRole('form', { name: 'Comprar' })
        .getByRole('button', { name: 'Añadir al carrito' }),
    ).toHaveCount(0);
  });
});
