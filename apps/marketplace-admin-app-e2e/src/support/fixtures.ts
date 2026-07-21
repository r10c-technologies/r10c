import { ProductBrand } from '@r10c/business-ts-product-configuration-management';
import {
  configurationHandler,
  entityBackendHandlers,
} from '@r10c/entifix-ts-testing-e2e/fixtures';
import { defineEntifixE2eTest } from '@r10c/entifix-ts-testing-e2e/playwright';

import { brandSeed } from './catalog-seed';

/** Where the admin app is served, and where its adapters look for the service. */
export const APP_URL = process.env['BASE_URL'] ?? 'http://localhost:3001';
export const SERVICE_URL = 'http://localhost:3101/api';

export const BRAND_URL = `${SERVICE_URL}/product-brand`;

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

/** The mock catalog, for reseeding or for breaking on purpose. */
export const catalogBackend = backend;

/**
 * Two stubs, not one: the entity endpoint AND the app's `/api/config`. The
 * browser adapter resolves its base URL through the latter before it can issue
 * any entity request, so stubbing only the entity endpoint leaves the page
 * stuck and the spec passing vacuously.
 */
export const test = defineEntifixE2eTest({
  handlers: [
    configurationHandler(`${APP_URL}/api/config`, CONFIGURATION),
    ...handlers,
  ],
  // The app serves its own documents, RSC payloads and dev-tooling endpoints;
  // only unstubbed *service* traffic should fail a test.
  passthroughOrigins: [APP_URL],
});

export { expect } from '@playwright/test';
