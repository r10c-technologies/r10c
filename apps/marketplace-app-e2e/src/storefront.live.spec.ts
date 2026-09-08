import {
  baseTest as test,
  expect,
  requireLiveUrl,
} from '@r10c/entifix-ts-testing-e2e/playwright';

import {
  FEATURED_OFFERINGS,
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

test.describe('browsing the published catalog', () => {
  test('home features the first six offerings by name', async ({ page }) => {
    await page.goto('/es');

    await expect(
      page.getByRole('heading', { name: 'Marketplace r10c' }),
    ).toBeVisible();

    for (const offering of FEATURED_OFFERINGS) {
      await expect(
        page.getByRole('heading', { name: offering.name }),
      ).toBeVisible();
    }
    // Six, because the page asks for six — so this is the real service's paging
    // answering, not the whole projection rendered.
    await expect(page.getByRole('link', { name: 'Ver producto' })).toHaveCount(
      FEATURED_OFFERINGS.length,
    );
  });

  /**
   * Click-driven rather than URL-driven: typing the address would prove the
   * page renders, not that anything links to it. A catalog whose products are
   * unreachable still passes every route test.
   */
  test('a featured card leads to its offering, addressed by offering id', async ({
    page,
  }) => {
    const featured = FEATURED_OFFERINGS[0];
    await page.goto('/es');

    await page.getByRole('link', { name: 'Ver producto' }).first().click();
    await page.waitForURL(`**/es/p/${featured.offeringId}`);

    await expect(
      page.getByRole('heading', { name: featured.name }),
    ).toBeVisible();
    // ⚠️ `toContainText` on the document rather than `getByText` per value.
    // The brand, the reference and the category are each rendered as a label
    // and a value inside one `Text`, so a text locator can match the wrapper
    // and the span both and fail strict mode for a page that is perfectly
    // correct.
    const body = page.locator('body');

    // The brand and the category are **names**, resolved out of
    // `catalog-reference` — a different store, in a different plane, reached
    // through its own read path. The snapshot carries only their ids, so a page
    // rendering these proves both reads happened.
    await expect(body).toContainText(featured.brandName);
    await expect(body).toContainText(`Categoría: ${featured.categoryName}`);
    // Merchandising copied off the pinned specification at publication time.
    await expect(body).toContainText(`Referencia: ${featured.code}`);
    // Minor units, rendered by `Intl` for this locale — `8499` USD reads
    // `84,99` in Spanish, comma and all. The separator is the assertion: a page
    // that skipped `formatMoney` would show `8499`.
    await expect(body).toContainText(
      (featured.amount / 100).toFixed(2).replace('.', ','),
    );
  });

  test('a category lists only what was published into it', async ({ page }) => {
    const featured = FEATURED_OFFERINGS[0];
    const siblings = PUBLISHED_OFFERINGS.filter(
      offering => offering.categoryCode === featured.categoryCode,
    );

    await page.goto(`/es/c/${featured.categoryCode}`);

    await expect(
      page.getByRole('heading', { name: featured.categoryName }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: featured.name }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ver producto' })).toHaveCount(
      siblings.length,
    );
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
        page.getByRole('heading', { name: offering.name }),
      ).toBeVisible();
    }
    await expect(page.getByRole('link', { name: 'Ver producto' })).toHaveCount(
      SEARCH_HIT.published.length,
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

  test('a draft offering has no page, even at its own address', async ({
    page,
  }) => {
    await page.goto(`/es/p/${UNPUBLISHED_OFFERING.offeringId}`);

    // ⚠️ The **absence of the product**, not the status code. ADR 0051 measured
    // that `notFound()` raised from inside a `layer:shell` package renders the
    // not-found UI without carrying its `404` — a real defect, recorded there
    // and owned by whatever explains that asymmetry. Asserting `200` here would
    // pin the bug in place; asserting `404` would fail for a page that behaves
    // exactly as this record says it does. What must hold either way is that
    // nothing unpublished is rendered.
    await expect(page.locator('body')).not.toContainText(
      UNPUBLISHED_OFFERING.name,
    );
    await expect(
      page.getByRole('button', { name: 'Añadir al carrito' }),
    ).toHaveCount(0);
  });
});
