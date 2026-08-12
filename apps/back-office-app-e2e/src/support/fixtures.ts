import {
  Product,
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-product-configuration-management';
import {
  configurationHandler,
  entityBackendHandlers,
} from '@r10c/entifix-ts-testing-e2e/fixtures';
import {
  defineEntifixE2eTest,
  seedSession,
} from '@r10c/entifix-ts-testing-e2e/playwright';

import { brandSeed, categorySeed, productSeed } from './catalog-seed';

/** Where the admin app is served, and where its adapters look for the service. */
export const APP_URL = process.env['BASE_URL'] ?? 'http://localhost:3001';
export const SERVICE_URL = 'http://localhost:3101/api';

export const BRAND_URL = `${SERVICE_URL}/product-brand`;
export const CATEGORY_URL = `${SERVICE_URL}/product-category`;
export const PRODUCT_URL = `${SERVICE_URL}/product`;

/**
 * The one configuration value the REST adapters need in order to build their
 * URLs. In `live` the app resolves it from config-service instead.
 */
const CONFIGURATION = {
  uri: [{ key: 'marketplace-admin-service-domain', value: SERVICE_URL }],
};

const { handlers, backend } = entityBackendHandlers(ProductBrand, {
  baseUrl: BRAND_URL,
  seed: brandSeed,
});

/**
 * The other two catalog entities, so a journey through the product form has both
 * relations to pick from. One backend per entity, because each serves the routes
 * of its own collection.
 */
const categories = entityBackendHandlers(ProductCategory, {
  baseUrl: CATEGORY_URL,
  seed: categorySeed,
});
const products = entityBackendHandlers(Product, {
  baseUrl: PRODUCT_URL,
  seed: productSeed,
});

/** The mock catalog, for reseeding or for breaking on purpose. */
export const catalogBackend = backend;
export const categoryBackend = categories.backend;
export const productBackend = products.backend;

/**
 * Two stubs, not one: the entity endpoint AND the app's `/api/config`. The
 * browser adapter resolves its base URL through the latter before it can issue
 * any entity request, so stubbing only the entity endpoint leaves the page
 * stuck and the spec passing vacuously.
 */
const base = defineEntifixE2eTest({
  handlers: [
    configurationHandler(`${APP_URL}/api/config`, CONFIGURATION),
    ...handlers,
    ...categories.handlers,
    ...products.handlers,
  ],
  // The app serves its own documents, RSC payloads and dev-tooling endpoints;
  // only unstubbed *service* traffic should fail a test.
  passthroughOrigins: [APP_URL],
});

/**
 * Every catalog journey runs signed in, because the app is now gated: its
 * middleware bounces a request with no access cookie, and the sidebar renders
 * only what the caller's roles grant. The session is seeded on the context
 * before the first navigation — an `auto` fixture rather than a per-spec call,
 * so a new spec cannot forget it and get a redirect instead of a page.
 *
 * `admin` because these journeys both read and write the catalog.
 */
export const test = base.extend<{ session: void }>({
  session: [
    async ({ context }, use) => {
      await seedSession(context, { roles: ['admin'] });
      await use();
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
