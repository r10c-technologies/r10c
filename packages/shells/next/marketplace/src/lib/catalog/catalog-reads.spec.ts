import {
  type Entity,
  type EntityConstructor,
  makeEntityPageEnvelope,
} from '@entifix/core';
import {
  http,
  HttpResponse,
  setupEntifixServer,
} from '@entifix/testing-unit/http';
import {
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-catalog-reference';
import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import {
  getBrand,
  getCategoryByCode,
  loadCategories,
} from '@r10c/implementation-catalog-reference-next';
import {
  getOffering,
  loadOfferings,
} from '@r10c/implementation-marketplace-catalog-next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { emptyPage, makeRunRead } from './catalog-reads.js';

/**
 * These run the cells' reads through the storefront's **real** composition —
 * the real generic load use case over the real REST adapters, against msw. So
 * what is under test is the wiring the storefront actually ships: the gated
 * configuration lookup, the URL composed from it, the RSQL each read turns into
 * on the wire, and what happens when none of it answers. What each read asks
 * for is the cells' own spec.
 *
 * Every case builds its own runner; see {@link load}.
 */

const CONFIG_URL = 'http://localhost:3190/api/config/marketplace-app';
const SERVICE_URL = 'http://service/api';
const OFFERING_URL = `${SERVICE_URL}/published-offering`;
const BRAND_URL = `${SERVICE_URL}/product-brand`;
const CATEGORY_URL = `${SERVICE_URL}/product-category`;

const CONFIGURATION = {
  uri: [{ key: 'marketplace-service-domain', value: SERVICE_URL }],
};

const offering = (
  offeringId: string,
  name: string,
  extra: Partial<{
    code: string;
    brandId: string;
    categoryId: string;
  }> = {},
) => {
  const one = new PublishedOffering(offeringId, 'vendor-1', name);
  one.id = offeringId;
  one.amount = 1999;
  one.currency = 'GTQ';
  one.availableHint = true;
  one.publishedAt = new Date('2026-01-01T00:00:00.000Z');
  if (extra.code !== undefined) one.code = extra.code;
  if (extra.brandId !== undefined) one.brandId = extra.brandId;
  if (extra.categoryId !== undefined) one.categoryId = extra.categoryId;
  return one;
};

const brand = (id: string, name: string) => {
  const one = new ProductBrand(name);
  one.id = id;
  one.code = name.slice(0, 3).toUpperCase();
  return one;
};

const category = (id: string, code: string, name: string) => {
  const one = new ProductCategory(code, name);
  one.id = id;
  return one;
};

const OFFERINGS = [
  offering('offering-1', 'Lámpara Aurora', {
    code: 'AUR-LAMP-01',
    brandId: 'brand-aurora',
    categoryId: 'category-lighting',
  }),
  offering('offering-2', 'Taza Terra', { categoryId: 'category-tableware' }),
];
const BRANDS = [brand('brand-aurora', 'Aurora')];
const CATEGORIES = [
  category('category-lighting', 'lighting', 'Iluminación'),
  category('category-tableware', 'tableware', 'Mesa'),
];

/** Every query string the adapters sent, in order, keyed by collection. */
const seen: Array<{ url: string; search: URLSearchParams }> = [];
/** The headers the configuration lookup carried, for the token assertion. */
let configHeaders: Headers | undefined;

const page = <TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  items: TEntity[],
) =>
  HttpResponse.json(
    makeEntityPageEnvelope(entityConstructor, {
      items,
      total: items.length,
      request: {},
    }),
  );

const collection = <TEntity extends Entity>(
  url: string,
  entityConstructor: EntityConstructor<TEntity>,
  rows: TEntity[],
) =>
  http.get(url, ({ request }) => {
    const search = new URL(request.url).searchParams;
    seen.push({ url, search });
    return page(entityConstructor, rows);
  });

const server = setupEntifixServer(
  http.get(CONFIG_URL, ({ request }) => {
    configHeaders = request.headers;
    return HttpResponse.json(CONFIGURATION);
  }),
  collection(OFFERING_URL, PublishedOffering, OFFERINGS),
  collection(BRAND_URL, ProductBrand, BRANDS),
  collection(CATEGORY_URL, ProductCategory, CATEGORIES),
);

/**
 * A fresh runner, so its configuration client — memoized for the life of the
 * instance — starts empty in every case. Without it a second test would reuse
 * the first test's configuration, and the "config-service is down" case would
 * pass against a cached success.
 */
const load = () => ({
  runRead: makeRunRead(),
  emptyPage,
  loadOfferings,
  getOffering,
  loadCategories,
  getCategoryByCode,
  getBrand,
});

const requestTo = (url: string) => seen.find(entry => entry.url === url);

/** The RSQL the adapters put on the wire, whatever parameter carries it. */
const rsqlOf = (url: string) => {
  const entry = requestTo(url);
  if (entry === undefined) return undefined;
  for (const [, value] of entry.search) {
    if (value.includes('==') || value.includes('=like=')) return value;
  }
  return undefined;
};

/** Swallows the fail-soft log so a deliberate failure does not print. */
const noop = () => undefined;

beforeEach(() => {
  seen.length = 0;
  configHeaders = undefined;
});

describe('the configuration lookup', () => {
  /**
   * ⚠️ config-service's fleet lookup serves real connection strings and cannot
   * redact them, so it is gated. A server component reads it directly — there
   * is no app route in between to add the header — which is why this is
   * asserted rather than assumed.
   */
  it('carries the shared fleet token', async () => {
    const { runRead, loadOfferings, emptyPage } = load();

    await runRead(PublishedOffering, loadOfferings(), emptyPage());

    expect(configHeaders?.get('x-service-token')).toBeTruthy();
  });

  it('composes the entity URL from the configured domain', async () => {
    const { runRead, loadOfferings, emptyPage } = load();

    await runRead(PublishedOffering, loadOfferings(), emptyPage());

    expect(requestTo(OFFERING_URL)).toBeDefined();
  });
});

describe('the offering reads, on the wire', () => {
  it('returns the projected offerings', async () => {
    const { runRead, loadOfferings, emptyPage } = load();

    const result = await runRead(
      PublishedOffering,
      loadOfferings(),
      emptyPage<PublishedOffering>(),
    );

    expect(result.items.map(item => item.name)).toEqual([
      'Lámpara Aurora',
      'Taza Terra',
    ]);
    expect(result.items[0]?.amount).toBe(1999);
  });

  it('sends a category subtree and a name match as RSQL', async () => {
    const { runRead, loadOfferings, emptyPage } = load();

    await runRead(
      PublishedOffering,
      loadOfferings({
        categoryIds: ['category-lighting', 'category-desk'],
        search: 'lámpara',
      }),
      emptyPage(),
    );

    expect(rsqlOf(OFFERING_URL)).toContain(
      'categoryId=in=(category-lighting,category-desk)',
    );
    expect(rsqlOf(OFFERING_URL)).toContain('name=like=lámpara');
  });

  it('sends the sort, the direction and the page', async () => {
    const { runRead, loadOfferings, emptyPage } = load();

    await runRead(
      PublishedOffering,
      loadOfferings({ sort: 'code', direction: 'desc', page: 2, pageSize: 6 }),
      emptyPage(),
    );

    const search = requestTo(OFFERING_URL)?.search;
    expect(search?.get('page')).toBe('2');
    expect(search?.get('pageSize')).toBe('6');
    expect(search?.get('sort')).toContain('code');
  });

  // The home page and the category page both sort without naming a direction.
  it('sorts ascending when no direction is named', async () => {
    const { runRead, loadOfferings, emptyPage } = load();

    await runRead(
      PublishedOffering,
      loadOfferings({ sort: 'name' }),
      emptyPage(),
    );

    expect(requestTo(OFFERING_URL)?.search.get('sort')).toBe('+name');
  });

  /**
   * ⚠️ A filtered `load`, never `get` (ADR 0049): `get` answers an absent row
   * with `EntifixConnError`, the same class a driver failure raises, so a 404
   * page and a datastore outage would be one code path.
   */
  it('looks one offering up by an offeringId filter', async () => {
    const { runRead, getOffering } = load();

    const found = await runRead(
      PublishedOffering,
      getOffering('offering-1'),
      undefined,
    );

    expect(found?.name).toBe('Lámpara Aurora');
    expect(rsqlOf(OFFERING_URL)).toContain('offeringId==offering-1');
  });
});

describe('the vocabulary reads, on the wire', () => {
  it('resolves a category code with a code filter', async () => {
    const { runRead, getCategoryByCode } = load();

    const found = await runRead(
      ProductCategory,
      getCategoryByCode('lighting'),
      undefined,
    );

    expect(found?.id).toBe('category-lighting');
    expect(rsqlOf(CATEGORY_URL)).toContain('code==lighting');
  });

  it('returns every category sorted by name', async () => {
    const { runRead, loadCategories, emptyPage } = load();

    const result = await runRead(
      ProductCategory,
      loadCategories(),
      emptyPage<ProductCategory>(),
    );

    expect(result.items.map(item => item.code)).toEqual([
      'lighting',
      'tableware',
    ]);
    expect(requestTo(CATEGORY_URL)?.search.get('sort')).toContain('name');
  });

  it('resolves a brand an offering names', async () => {
    const { runRead, getBrand } = load();

    expect(
      (await runRead(ProductBrand, getBrand('brand-aurora'), undefined))?.name,
    ).toBe('Aurora');
    expect(requestTo(BRAND_URL)).toBeDefined();
  });
});

/**
 * ⚠️ The half that keeps `next build` hermetic. Home is prerendered per locale
 * and a build machine has no fleet, so a throw here would make the build depend
 * on a running backend — and a storefront that answers `500` because one
 * backend blinked is worse than one that renders its own empty copy.
 *
 * The cost is stated rather than hidden: empty and broken render identically,
 * and the log is the only thing that tells them apart.
 */
describe('when the backend does not answer', () => {
  it('answers the fallback instead of rejecting', async () => {
    const { runRead, loadOfferings, emptyPage } = load();
    const logged = vi.spyOn(console, 'error').mockImplementation(noop);

    server.use(http.get(OFFERING_URL, () => HttpResponse.error()));

    const result = await runRead(
      PublishedOffering,
      loadOfferings(),
      emptyPage<PublishedOffering>(),
    );

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining('PublishedOffering'),
    );
    logged.mockRestore();
  });

  it('survives configuration itself being unreachable', async () => {
    const { runRead, loadCategories, emptyPage } = load();
    const logged = vi.spyOn(console, 'error').mockImplementation(noop);

    server.use(
      http.get(CONFIG_URL, () => new HttpResponse(null, { status: 503 })),
    );

    expect(
      (await runRead(ProductCategory, loadCategories(), emptyPage())).items,
    ).toEqual([]);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
