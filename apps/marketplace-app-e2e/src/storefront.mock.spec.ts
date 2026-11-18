import { baseTest as test, expect } from '@entifix/testing-e2e/playwright';
import type { Locator } from '@playwright/test';

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

    // The h1 is the store's promise, not its name again (#570): the masthead
    // link already names it.
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toHaveText(
      'Productos de varios vendedores, en una sola tienda',
    );
    await expect(
      page.getByRole('banner').getByRole('link', { name: 'Marketplace r10c' }),
    ).toBeVisible();
    await expect(
      page
        .getByRole('list', { name: 'Por qué comprar aquí' })
        .getByRole('listitem'),
    ).toHaveText([
      'Compra a varios vendedores en un solo pedido.',
      'Puedes cancelar desde tu recibo mientras tu pedido no ha salido.',
    ]);

    // The card is the link: its title, stretched over it (#568).
    await page
      .getByRole('region', { name: 'Destacados' })
      .getByRole('article')
      .first()
      .getByRole('link')
      .click();

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
    await expect(
      tiles.getByRole('link', { name: /Iluminación/ }),
    ).toBeVisible();
    await expect(
      tiles.getByRole('link', { name: /Lámparas de escritorio/ }),
    ).toHaveCount(0);
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
        .getByRole('link', { name: 'Iluminación' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Archivo' })).toHaveCount(0);

    const response = await page.goto('/es/c/archive');
    expect(response?.status()).toBe(404);
    await expect(page.locator('body')).not.toContainText('Archivo');
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
        .getByRole('link', { name: 'Lámparas de escritorio' }),
    ).toHaveCount(0);
    await expect(
      page
        .getByRole('navigation', { name: 'Subcategorías' })
        .getByRole('link', { name: 'Lámparas de escritorio' }),
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
    await expect(
      trail.getByRole('link', { name: 'Iluminación' }),
    ).toBeVisible();
    await expect(
      trail.getByRole('link', { name: 'Lámparas de escritorio' }),
    ).toBeVisible();
    await expect(trail.getByText('Luces de trabajo')).toHaveAttribute(
      'aria-current',
      'page',
    );
    // A leaf offers nothing to narrow into.
    await expect(
      page.getByRole('navigation', { name: 'Subcategorías' }),
    ).toHaveCount(0);
  });

  /**
   * #572, #573: a category's name and description are written per locale, and
   * each page reads its own — in the nav, the trail, the heading, the facet,
   * the title, the meta description and home's tiles.
   */
  test('a category speaks the page’s language', async ({ page }) => {
    for (const [locale, name, child, description] of [
      ['es', 'Cocina', 'Iluminación', 'Utensilios y almacenaje para cocinar.'],
      ['en', 'Kitchen', 'Lighting', 'Tools and storage for cooking.'],
    ] as const) {
      await page.goto(`/${locale}/c/kitchen`);
      await expect(
        page.getByRole('main').getByRole('heading', { level: 1 }),
      ).toHaveText(name);
      await expect(page.getByRole('main')).toContainText(description);
      await expect(page).toHaveTitle(`${name} · r10c · Marketplace`);
      await expect(page.locator('meta[name="description"]')).toHaveAttribute(
        'content',
        description,
      );
      await expect(
        page
          .getByRole('navigation', { name: /Catálogo|Catalog/ })
          .getByRole('link', { name: child }),
      ).toBeVisible();

      await page.goto(`/${locale}`);
      await expect(
        page
          .getByRole('region', { name: /Categorías|Categories/ })
          .getByRole('link', { name: new RegExp(name) }),
      ).toContainText(description);
    }
  });

  /** #573: the category facet is ordered by the name in the page's locale. */
  test('the category facet sorts by the page’s locale', async ({ page }) => {
    const facet = (locale: 'es' | 'en') =>
      page
        .getByRole('complementary', { name: /Filtrar|Filter/ })
        .getByRole('region', { name: /Categoría|Category/ })
        .getByRole('link');

    // The two locales disagree at the end: "Textiles del hogar" sorts before
    // "Vajilla", while "Tableware" sorts before "Textiles".
    await page.goto('/es/search');
    await expect(facet('es')).toHaveText([
      /Cocina/,
      /Iluminación/,
      /Textiles del hogar/,
      /Vajilla/,
    ]);
    await page.goto('/en/search');
    await expect(facet('en')).toHaveText([
      /Kitchen/,
      /Lighting/,
      /Tableware/,
      /Textiles/,
    ]);
  });

  /** #337: the product page shows the vendor's pictures, thumbnails linked. */
  test('a product page shows its gallery and its trail', async ({ page }) => {
    await page.goto('/es/p/offering-cobalto-arc-lamp');

    const gallery = page.getByRole('region', {
      name: 'Imágenes del producto',
    });
    // entifix's gallery: one figure per picture, the scroller a Tab stop so
    // arrow keys scroll it (a1-18), and each slide's neighbours a link away.
    await expect(gallery.getByRole('figure')).toHaveCount(3);
    await expect(gallery).toHaveAttribute('tabindex', '0');
    await expect(
      gallery.getByRole('img', { name: 'Cobalto Arc Lamp, marble foot' }),
    ).toBeVisible();
    await expect(
      gallery.getByRole('link', { name: 'Imagen siguiente' }).first(),
    ).toHaveAttribute('href', /^#/);
    const trail = page.getByRole('navigation', { name: 'Ruta de navegación' });
    await expect(
      trail.getByRole('link', { name: 'Iluminación' }),
    ).toBeVisible();
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
      'Iluminación',
      'COB-ARC-01',
      'Cobalto Studio',
    ]);
  });

  test('every card names its seller, so one product from two sellers reads as two', async ({
    page,
  }) => {
    await page.goto('/es/search?q=lino');

    const cards = page.getByRole('article', { name: 'Lino Napkin Set' });
    await expect(cards).toHaveCount(2);
    const sellers = await cards.getByTestId('card-seller').allTextContents();
    expect([...sellers].sort()).toEqual([
      'Vendido por Casa Solano',
      'Vendido por Demo Vendor',
    ]);
  });

  /**
   * Plan 1.17: a buyer names their phone and sees what fits it — made for that
   * model, or for every phone — and the choice comes back on a later visit.
   */
  test('choosing my phone keeps what fits it, and is remembered', async ({
    page,
  }) => {
    await page.goto('/es/search');
    const phone = page.getByRole('combobox', { name: 'Mi teléfono' });
    await expect(phone.getByRole('option', { name: 'Nokia 3310' })).toHaveCount(
      0,
    );

    await phone.selectOption({ label: 'Samsung Galaxy A15' });
    await page.getByRole('button', { name: 'Ver lo que le queda' }).click();

    await page.waitForURL(/model=device-model-a15/);
    await expect(page.getByText('2 productos')).toBeVisible();
    await expect(
      page.getByText('Mostrando lo que le queda a tu Samsung Galaxy A15.'),
    ).toBeVisible();
    await expect(
      page.getByRole('article', { name: 'Lino Napkin Set' }),
    ).toHaveCount(2);

    // A later visit: a new tab of the same browser starts unfiltered and is
    // given the remembered phone back.
    const later = await page.context().newPage();
    await later.goto('/es/search');
    await later.waitForURL(/model=device-model-a15/);
    await later.close();

    await page.getByRole('link', { name: 'Quitar' }).click();
    await page.waitForURL(url => !url.search.includes('model='));
    await expect(page.getByText('39 productos')).toBeVisible();
  });

  test('a card whose seller cannot be read still renders, without a seller line', async ({
    page,
  }) => {
    await page.goto('/es/search?q=eclipse');

    const card = page.getByRole('article', { name: 'Eclipse Table Runner' });
    await expect(card).toBeVisible();
    await expect(card.getByTestId('card-seller')).toHaveCount(0);
  });

  test('the related strip names each seller, and never the product in view', async ({
    page,
  }) => {
    await page.goto('/es/p/offering-terra-ceramic-mug');

    const related = page.getByRole('region', {
      name: 'También te puede interesar',
    });
    const cards = related.getByRole('article');
    await expect(cards.first()).toBeVisible();
    await expect(
      related.locator('a[href$="/p/offering-terra-ceramic-mug"]'),
    ).toHaveCount(0);
    const count = await cards.count();
    await expect(related.getByTestId('card-seller')).toHaveCount(count);
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

    await expect(page).toHaveTitle('Iluminación · r10c · Marketplace');
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
    // The order in force is the current choice, not a link to itself.
    await expect(
      page.locator('[aria-current="true"]', {
        hasText: 'Precio: mayor a menor',
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Precio: mayor a menor' }),
    ).toHaveCount(0);
    await expect(page.getByText('Aurora Desk Lamp')).toBeVisible();
  });

  // With no term, search lists the whole catalog (36 fixtures, 24 a page), so
  // the 25th result by name is on page 2 and reachable by a link.
  test('search pages through the whole catalog', async ({ page }) => {
    await page.goto('/es/search');
    // The 36 shared fixtures and the three this suite's mock adds (#567).
    await expect(page.getByText('39 productos')).toBeVisible();
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

  /**
   * #350: each option counts what choosing it would keep, and the counts are
   * disjunctive — choosing a brand leaves the other brands their numbers.
   */
  test('a facet counts its options, and choosing one keeps the others', async ({
    page,
  }) => {
    await page.goto('/es/search');
    const brands = page
      .getByRole('complementary', { name: 'Filtrar' })
      .getByRole('region', { name: 'Marca' });

    await expect(brands.getByRole('link', { name: 'Terra' })).toContainText(
      '6',
    );
    const aurora = await brands
      .getByRole('link', { name: 'Aurora' })
      .textContent();

    await brands.getByRole('link', { name: 'Terra' }).click();
    await page.waitForURL(/brand=brand-terra/);

    await expect(brands.getByRole('link', { name: 'Terra' })).toContainText(
      '6',
    );
    await expect(brands.getByRole('link', { name: 'Aurora' })).toHaveText(
      aurora ?? '',
    );
  });

  /**
   * #352: the price is the one facet a buyer types. It submits as a GET form,
   * in major units, and keeps the rest of the search.
   */
  test('a price range narrows the results', async ({ page }) => {
    await page.goto('/es/search?q=a');
    const price = page
      .getByRole('complementary', { name: 'Filtrar' })
      .getByRole('region', { name: 'Precio' });
    await price.getByRole('textbox', { name: 'Desde' }).fill('50');
    await price.getByRole('textbox', { name: 'Hasta' }).fill('100');
    await price.getByRole('button', { name: 'Aplicar' }).click();

    await page.waitForURL(/min=50/);
    await expect(page).toHaveURL(/q=a/);
    await expect(page).toHaveURL(/max=100/);
    // Every fixture between 50,00 and 100,00 in its own currency whose name
    // has an "a" — the range compares minor units, so 5000 ≤ amount ≤ 10000.
    await expect(page.getByRole('textbox', { name: 'Desde' })).toHaveValue(
      '50',
    );
    const articles = await page.getByRole('main').getByRole('article').all();
    // Not vacuous: the fixtures hold six offerings in range.
    expect(articles.length).toBeGreaterThan(0);
    for (const article of articles) {
      const price = Number(
        (
          await article
            .getByText(/\d+,\d{2}/)
            .first()
            .innerText()
        )
          .replace(/[^\d,]/g, '')
          .replace(',', '.'),
      );
      expect(price).toBeGreaterThanOrEqual(50);
      expect(price).toBeLessThanOrEqual(100);
    }
  });

  test('the in-stock toggle leaves out what is sold out', async ({ page }) => {
    await page.goto('/es/search');
    await expect(page.getByText('39 productos')).toBeVisible();

    await page
      .getByRole('complementary', { name: 'Filtrar' })
      .getByRole('link', { name: 'Solo disponibles' })
      .click();

    await page.waitForURL(/available=1/);
    await expect(page.getByText('32 productos')).toBeVisible();
  });

  test('sorting by price and by newest reorders the results', async ({
    page,
  }) => {
    const first = () =>
      page.getByRole('main').getByRole('article').first().getByRole('heading');

    await page.goto('/es/search');
    await page.getByRole('link', { name: 'Precio: menor a mayor' }).click();
    await page.waitForURL(/sort=price-asc/);
    await expect(first()).toHaveText('Unbranded Kitchen Twine');

    await page.getByRole('link', { name: 'Más recientes' }).click();
    await page.waitForURL(/sort=newest/);
    await expect(first()).toHaveText('Terra Pasta Bowl');
  });

  test('the header searches from any page', async ({ page }) => {
    await page.goto('/es/c/lighting');
    await page.getByRole('searchbox').fill('mug');
    await page.getByRole('button', { name: 'Buscar' }).click();

    await page.waitForURL(/\/es\/search\?q=mug/);
    await expect(page.getByText('Terra Ceramic Mug')).toBeVisible();
  });

  // #379: a buyer types without the accent, or on a keyboard that lacks it.
  test('search finds a name whatever its accents', async ({ page }) => {
    await page.goto('/es/search?q=jarron');

    await expect(page.getByText('Marea Jarrón')).toBeVisible();
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

/**
 * #417: below `sm` the listing stacks, and an open panel put twenty lines of
 * filters above the first product. The panel folds behind a native disclosure
 * there and is forced open from `sm` up, with no script either way.
 */
/**
 * #533: a read that failed is not a catalog with nothing in it. The mock
 * backend answers this one term with a `503` (`support/server-mocks.mjs`).
 */
test.describe('a product card', () => {
  test('is one link and one action: the picture opens the product, the button only adds', async ({
    page,
  }) => {
    await page.goto('/es/search?q=lino');
    const card = page.getByRole('article').first();

    // Exactly one link and one button per card reach the keyboard (#568).
    await expect(card.getByRole('link')).toHaveCount(1);
    await expect(card.getByRole('button')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Ver producto' })).toHaveCount(
      0,
    );

    // A tap on the picture lands on the product: the title's link is
    // stretched over the whole card, so a click near its top-left corner, on
    // the media box, is a click on that link.
    await card.click({ position: { x: 12, y: 12 } });
    await page.waitForURL(/\/es\/p\/offering-lino-napkins-/);
  });

  test('on a phone, two cards share the first row, and it starts on the first screen', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/es');

    const cards = page
      .getByRole('region', { name: 'Lo más nuevo' })
      .getByRole('article');
    const [first, second] = await Promise.all([
      cards.nth(0).boundingBox(),
      cards.nth(1).boundingBox(),
    ]);
    expect(first?.y).toBe(second?.y);
    expect(first?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(844);
  });
});

/** Every card's top edge, by row: the count of cards in each distinct row. */
const cardsPerRow = async (strip: Locator) => {
  const tops = await strip
    .getByRole('article')
    .evaluateAll(cards =>
      cards.map(card => Math.round(card.getBoundingClientRect().top)),
    );
  const rows = new Map<number, number>();
  for (const top of tops) rows.set(top, (rows.get(top) ?? 0) + 1);
  return [...rows.values()];
};

test.describe('the storefront at each width', () => {
  test('desktop uses its width, and a home strip is one whole row', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/es');

    const main = await page.getByRole('main').boundingBox();
    expect(main?.width ?? 0).toBeGreaterThan(1100);
    for (const name of ['Lo más nuevo', 'Destacados']) {
      const strip = page.getByRole('region', { name });
      await expect(strip.getByRole('article').first()).toBeVisible();
      expect(await cardsPerRow(strip), name).toEqual([4]);
    }
  });

  for (const [width, height] of [
    [1024, 768],
    [390, 844],
  ] as const) {
    test(`a home strip fills whole rows at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/es');

      const strip = page.getByRole('region', { name: 'Lo más nuevo' });
      await expect(strip.getByRole('article').first()).toBeVisible();
      const rows = await cardsPerRow(strip);
      expect(new Set(rows).size, `rows of ${rows.join(', ')}`).toBe(1);
    });
  }

  test('the related strip holds four, and never the product in view', async ({
    page,
  }) => {
    await page.goto('/es/p/offering-terra-ceramic-mug');

    const related = page.getByRole('region', {
      name: 'También te puede interesar',
    });
    await expect(related.getByRole('article')).toHaveCount(4);
    await expect(
      related.getByRole('article', { name: 'Terra Ceramic Mug' }),
    ).toHaveCount(0);
  });
});

test.describe('product images', () => {
  test('a card’s picture is offered at the sizes it is shown, through the optimizer', async ({
    page,
  }) => {
    await page.goto('/es/search?q=aurora');

    const image = page
      .getByRole('article', { name: 'Aurora Desk Lamp' })
      .getByRole('img');
    await expect(image).toHaveAttribute('sizes', /50vw/);
    await expect(image).toHaveAttribute(
      'srcset',
      /\/_next\/image\?url=https%3A%2F%2Fpicsum\.photos%2F.+&w=320&q=75 320w/,
    );
  });

  test('a picture on a host the optimizer may not fetch renders as it is', async ({
    page,
  }) => {
    await page.goto('/es/search?q=eclipse');

    const image = page
      .getByRole('article', { name: 'Eclipse Table Runner' })
      .getByRole('img', { name: 'Runner, folded' });
    await expect(image).toHaveAttribute(
      'src',
      'https://media.example.org/runner.jpg',
    );
    await expect(image).not.toHaveAttribute('srcset', /./);
  });

  test('on a phone, no card picture is fetched at more than twice its width', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const asked: number[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname === '/_next/image') {
        asked.push(Number(url.searchParams.get('w')));
      }
    });
    await page.goto('/es');
    await expect.poll(() => asked.length).toBeGreaterThan(0);

    const shown = await page
      .getByRole('article')
      .getByRole('img')
      .evaluateAll(images => images.map(image => image.clientWidth));
    // At most twice the widest picture shown, or the narrowest width the
    // loader is ever asked for (entifix's ladder starts at 320): the point is
    // a thumbnail-sized fetch, never the vendor's 800px original.
    const ceiling = Math.max(2 * Math.max(...shown), 320);
    for (const width of asked) expect(width).toBeLessThanOrEqual(ceiling);
  });

  test('the gallery fetches its first picture first, and the rest lazily', async ({
    page,
  }) => {
    await page.goto('/es/p/offering-aurora-desk-lamp');

    const images = page
      .getByRole('region', { name: 'Imágenes del producto' })
      .getByRole('img');
    await expect(images.first()).toHaveAttribute('fetchpriority', 'high');
    await expect(images.first()).toHaveAttribute('srcset', /\/_next\/image/);
    await expect(images.nth(1)).toHaveAttribute('loading', 'lazy');
  });

  test('home does not shift as its pictures arrive', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto('/es');
    // Every picture on the page has arrived (or failed) before shifts are read.
    await expect
      .poll(() =>
        page.evaluate(() =>
          Array.from(document.images).every(image => image.complete),
        ),
      )
      .toBe(true);

    const shift = await page.evaluate(
      () =>
        new Promise<number>(resolve => {
          let total = 0;
          new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
              const shiftEntry = entry as PerformanceEntry & {
                value: number;
                hadRecentInput: boolean;
              };
              if (!shiftEntry.hadRecentInput) total += shiftEntry.value;
            }
          }).observe({ type: 'layout-shift', buffered: true });
          setTimeout(() => resolve(total), 500);
        }),
    );
    expect(shift.toFixed(3)).toBe('0.000');
  });
});

test.describe('a listing whose read failed', () => {
  test('says so, offers a retry, and never says there is nothing', async ({
    page,
  }) => {
    await page.goto('/es/search?q=e2e-backend-down');

    const notice = page.getByTestId('catalog-unavailable');
    await expect(notice).toHaveRole('status');
    await expect(notice).toContainText('No pudimos cargar el catálogo');
    await expect(
      notice.getByRole('link', { name: 'Reintentar' }),
    ).toHaveAttribute('href', /\/es\/search\?q=e2e-backend-down/);
    await expect(page.getByText('No encontramos nada para')).toHaveCount(0);
    await expect(page.getByText('Ningún producto coincide')).toHaveCount(0);
  });
});

test.describe('a listing on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const path of ['/es/search', '/es/c/lighting']) {
    test(`${path} shows products first, the filters one tap away`, async ({
      page,
    }) => {
      await page.goto(path);
      const panel = page.getByRole('complementary', { name: 'Filtrar' });

      await expect(
        page.getByRole('main').getByRole('article').first(),
      ).toBeInViewport();
      await expect(panel).toBeHidden();

      await page.locator('summary', { hasText: 'Filtrar' }).click();
      await expect(panel).toBeVisible();
    });
  }

  test('the disclosure counts the filters in force', async ({ page }) => {
    await page.goto('/es/search?brand=brand-terra&available=1');

    await expect(page.locator('summary', { hasText: 'Filtrar' })).toHaveText(
      'Filtrar (2)',
    );
  });
});

test.describe('a listing on a wide screen', () => {
  test('shows the panel open, with no disclosure to open', async ({ page }) => {
    await page.goto('/es/search');

    await expect(
      page.getByRole('complementary', { name: 'Filtrar' }),
    ).toBeVisible();
    // Every narrow-screen disclosure — the masthead's categories, the
    // filters, the sort — is open from `sm` up, with its summary hidden.
    const summaries = page.locator('summary');
    await expect(summaries).toHaveCount(3);
    for (const summary of await summaries.all()) {
      await expect(summary).toBeHidden();
    }
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
    await page.waitForURL(/\/es\/cart(\?|$)/);
    await expect(page).toHaveURL(/\/es\/cart(\?|$)/);
    await expect(
      page.getByRole('main').getByText('Aurora Desk Lamp', { exact: true }),
    ).toBeVisible();

    // The point of the cookie: a full reload still has it, because the server
    // rendered it — not because a client store rehydrated.
    await page.reload();
    await expect(
      page.getByRole('main').getByText('Aurora Desk Lamp', { exact: true }),
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
      await page.waitForURL(/\/es\/cart(\?|$)/);
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

    await page.waitForURL(/\/es\/cart(\?|$)/);
    await expect(page.getByTestId('cart-line-price')).toContainText('39,98');
  });

  test('a cart is kept out of search engines', async ({ page }) => {
    await page.goto('/es/cart');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    );
  });

  test('a card adds and keeps the buyer on the listing, and the header says so', async ({
    page,
  }) => {
    await page.goto('/es/search?q=lino');
    await page
      .getByRole('article')
      .first()
      .getByRole('button', { name: /^Añadir .+ al carrito$/ })
      .click();

    // Back on the same listing, query and all (#574), never on the cart.
    await page.waitForURL(/\/es\/search\?q=lino&added=/);
    await expect(
      page.getByRole('status').filter({ hasText: 'Lino Napkin Set' }),
    ).toContainText('Se añadió Lino Napkin Set al carrito.');
    await expect(page.getByTestId('cart-count')).toHaveText('1');
    await expect(
      page.getByRole('link', { name: 'Carrito (1 artículo)' }),
    ).toBeVisible();

    await page.getByRole('link', { name: 'Ver carrito' }).click();
    await page.waitForURL(/\/es\/cart$/);
    await expect(page.getByTestId('cart-line-price')).toHaveCount(1);
  });

  for (const [what, returnTo] of [
    ['another origin', 'https://example.com/x'],
    ['a protocol-relative host', '//example.com'],
  ] as const) {
    test(`an add told to return to ${what} lands on the cart instead`, async ({
      page,
    }) => {
      await page.goto('/es/search?q=lino');
      const card = page.getByRole('article').first();
      // The field is the buyer's to tamper with; the action must not follow it.
      await card.locator('input[name="returnTo"]').evaluate((input, value) => {
        (input as HTMLInputElement).value = value;
      }, returnTo);
      await card
        .getByRole('button', { name: /^Añadir .+ al carrito$/ })
        .click();

      await page.waitForURL(/\/es\/cart\?added=/);
      await expect(page).toHaveURL(/^http:\/\/localhost:3000\/es\/cart\?/);
    });
  }

  test('a quantity is changed in the cart, and zero removes the line', async ({
    page,
  }) => {
    await page.goto('/es/p/offering-aurora-desk-lamp');
    await page
      .getByRole('form', { name: 'Comprar' })
      .getByRole('button', { name: 'Añadir al carrito' })
      .click();
    await page.waitForURL(/\/es\/cart(\?|$)/);

    const quantity = page.getByRole('spinbutton', {
      name: 'Cantidad de Aurora Desk Lamp',
    });
    await quantity.fill('3');
    await page.getByRole('button', { name: 'Actualizar' }).click();

    // 3 × 1999 minor units: the server re-rendered the line and the total.
    await expect(page.getByTestId('cart-line-price')).toContainText('59,97');
    await expect(page.getByTestId('cart-total')).toContainText('59,97');

    await quantity.fill('0');
    await page.getByRole('button', { name: 'Actualizar' }).click();
    await expect(page.getByText('Tu carrito está vacío.')).toBeVisible();
  });

  test('the header badge fills in from the cookie', async ({ page }) => {
    await page.goto('/es/p/offering-terra-ceramic-mug');
    await page
      .getByRole('form', { name: 'Comprar' })
      .getByRole('button', { name: 'Añadir al carrito' })
      .click();
    await page.waitForURL(/\/es\/cart(\?|$)/);
    await expect(page).toHaveURL(/\/es\/cart(\?|$)/);

    // Home is prerendered, so its HTML carries no count at all — the island
    // fills it in from the cookie once it mounts.
    await page.goto('/es');
    await expect(page.getByTestId('cart-count')).toHaveText('1');
  });

  /**
   * a4-6: removing a line is immediate, so it says so in a status region and
   * offers the way back — with the count the line had, not one — and all of it
   * is forms, so it needs no script.
   */
  test('a removed line is announced, and Undo puts it back with its count', async ({
    page,
  }) => {
    await page.goto('/es/p/offering-aurora-desk-lamp');
    const buy = page.getByRole('form', { name: 'Comprar' });
    await buy.getByRole('spinbutton', { name: 'Cantidad' }).fill('3');
    await buy.getByRole('button', { name: 'Añadir al carrito' }).click();
    await page.waitForURL(/\/es\/cart(\?|$)/);

    await page
      .getByRole('button', { name: 'Quitar Aurora Desk Lamp del carrito' })
      .click();

    const removed = page.getByRole('status').filter({
      hasText: 'Se quitó Aurora Desk Lamp del carrito.',
    });
    await expect(removed).toBeVisible();
    await expect(page.getByText('Tu carrito está vacío')).toBeVisible();

    await removed.getByRole('button', { name: 'Deshacer' }).click();

    await expect(
      page.getByRole('spinbutton', { name: 'Cantidad de Aurora Desk Lamp' }),
    ).toHaveValue('3');
    await expect(page.getByTestId('cart-line-price')).toContainText('59,97');
    await expect(page.getByTestId('cart-removed')).toHaveCount(0);
  });

  /** a3-27: an add is announced, not only shown by the page it lands on. */
  test('an add is announced in a status region', async ({ page }) => {
    await page.goto('/es/p/offering-terra-ceramic-mug');
    await page
      .getByRole('form', { name: 'Comprar' })
      .getByRole('button', { name: 'Añadir al carrito' })
      .click();
    await page.waitForURL(/\/es\/cart\?added=/);

    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'Se añadió Terra Ceramic Mug al carrito.' }),
    ).toBeVisible();
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

  // #574: the badge is named by its count in words, not by a bare number.
  test('the cart badge counts its items in words, in both locales', async ({
    page,
  }) => {
    const add = async () => {
      await page.goto('/es/p/offering-terra-ceramic-mug');
      await page
        .getByRole('form', { name: 'Comprar' })
        .getByRole('button', { name: 'Añadir al carrito' })
        .click();
      await page.waitForURL(/\/es\/cart(\?|$)/);
    };

    await add();
    await page.goto('/es');
    await expect(
      page.getByRole('link', { name: 'Carrito (1 artículo)' }),
    ).toBeVisible();
    await page.goto('/en');
    await expect(
      page.getByRole('link', { name: 'Cart (1 item)' }),
    ).toBeVisible();

    await add();
    await page.goto('/es');
    await expect(
      page.getByRole('link', { name: 'Carrito (2 artículos)' }),
    ).toBeVisible();
    await page.goto('/en');
    await expect(
      page.getByRole('link', { name: 'Cart (2 items)' }),
    ).toBeVisible();
  });
});

test.describe('a card add with scripting off', () => {
  /**
   * The notice is the server's, not a script's: it is in the document the
   * redirect lands on. Asserted on the response rather than in a script-free
   * browser, which shows only the fallback of the listing's streamed hole
   * (see `checkout.mock.spec.ts`).
   */
  test('the listing it returns to says what was added, from the server', async ({
    request,
  }) => {
    const response = await request.get(
      '/es/search?q=lino&added=offering-lino-napkins-demo',
    );
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain(
      'Se añadió Lino Napkin Set al carrito.',
    );
  });
});
