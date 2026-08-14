import { ProductBrand } from '@r10c/business-ts-catalog-reference';
import { ProductSpecification } from '@r10c/business-ts-product-configuration-management';
import {
  ConfigurationRepositoryTag,
  EntityRepositoryTag,
} from '@r10c/entifix-ts-business';
import {
  http,
  HttpResponse,
  setupEntifixServer,
} from '@r10c/entifix-ts-testing-unit/http';
import { Context, Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { createClientAdapters } from './create-client-adapters.js';

const SERVICE = 'http://marketplace-admin-service:3101/api';
/** The platform-plane vocabulary lives in a second backend since ADR 0022. */
const REFERENCE_SERVICE = 'http://marketplace-service:3100/api';

// `/api/config` is same-origin in the browser; under Node it resolves against
// the test server's origin, which MSW answers here.
const configuration = {
  uri: [
    { key: 'marketplace-admin-service-domain', value: SERVICE },
    { key: 'marketplace-service-domain', value: REFERENCE_SERVICE },
  ],
};

const emptyPage = (entity: string) =>
  HttpResponse.json({
    meta: { type: 'entityPage', entity },
    data: { items: [], total: 0, request: {} },
  });

const server = setupEntifixServer(
  http.get('*/api/config', () => HttpResponse.json(configuration)),
  http.get(`${SERVICE}/product-specification`, () =>
    emptyPage('product-specification'),
  ),
  http.get(`${REFERENCE_SERVICE}/product-brand`, () =>
    emptyPage('product-brand'),
  ),
);

const recordRequests = () => {
  const urls: string[] = [];
  server.events.on('request:start', ({ request }) => {
    urls.push(request.url);
  });
  return urls;
};

describe('createClientAdapters', () => {
  it('exposes one repository per catalog entity plus the configuration store', () => {
    const adapters = createClientAdapters();

    expect(
      Context.get(adapters.productRest, EntityRepositoryTag),
    ).toBeDefined();
    expect(
      Context.get(adapters.productBrandRest, EntityRepositoryTag),
    ).toBeDefined();
    expect(
      Context.get(adapters.productCategoryRest, EntityRepositoryTag),
    ).toBeDefined();
    expect(
      Context.get(adapters.configurationStore, ConfigurationRepositoryTag),
    ).toBeDefined();
  });

  // Each entity gets its own context under the *same* tag, so a page merges
  // only the one it needs and the single tag never collides at the point of use.
  it('keeps each entity’s repository distinct', () => {
    const adapters = createClientAdapters();

    expect(Context.get(adapters.productRest, EntityRepositoryTag)).not.toBe(
      Context.get(adapters.productBrandRest, EntityRepositoryTag),
    );
  });

  // The URI is composed from a base plus the entity key, so the endpoint is
  // derived rather than listed per entity.
  it('composes the service base URL with the entity key', async () => {
    const urls = recordRequests();
    const adapters = createClientAdapters();
    const repository = Context.get(adapters.productRest, EntityRepositoryTag);

    await Effect.runPromise(
      Effect.provide(
        repository.load<ProductSpecification>({}),
        adapters.configurationStore,
      ),
    );

    expect(urls).toContain(`${SERVICE}/product-specification`);
  });

  // The regression this file exists to catch. Brands and categories moved to
  // `catalog-reference`, a store another slice owns, so composing their URL from
  // the admin service's domain requests a route that no longer exists — and the
  // e2e fixture, stubbing the same wrong address, could not see it.
  it('reads the platform vocabulary from marketplace-service', async () => {
    const urls = recordRequests();
    const adapters = createClientAdapters();
    const repository = Context.get(
      adapters.productBrandRest,
      EntityRepositoryTag,
    );

    await Effect.runPromise(
      Effect.provide(
        repository.load<ProductBrand>({}),
        adapters.configurationStore,
      ),
    );

    expect(urls).toContain(`${REFERENCE_SERVICE}/product-brand`);
  });

  it('returns a fresh adapter set per call', () => {
    expect(createClientAdapters()).not.toBe(createClientAdapters());
  });
});
