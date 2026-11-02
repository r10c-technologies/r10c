import { EntityRepositoryTag } from '@entifix/business';
import { Entity, EntityConstructor } from '@entifix/core';
import {
  buildEntityRestAdapterDelete,
  buildEntityRestAdapterGet,
  buildEntityRestAdapterLoad,
  buildEntityRestAdapterSave,
  BuildEntityRestOptions,
  ConfigurationClientRestClient,
  makeEntityMetadataSource,
  makeEntityRestUseCaseRunner,
} from '@entifix/rest';
import {
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-catalog-reference';
import {
  ProductOffering,
  ProductOfferingPrice,
  ProductSpecification,
} from '@r10c/business-ts-product-configuration-management';
import { Context } from 'effect';

import type { MarketplaceAdminAdapters } from '../client-types';

/**
 * Where every adapter below resolves its URL, bound when each is built — the
 * host's `/api/config`, so the lookup is same-origin and carries the session.
 */
const configuration = new ConfigurationClientRestClient();

const restOptionsFor = (domainKey: string): BuildEntityRestOptions => ({
  configuration,
  uriConfig: {
    key: `${domainKey}.[entity]`,
    group: 'uri',
    extractionMode: 'compose',
  },
});

/**
 * The two backends this shell reads, and which store each one owns.
 *
 * They were one until ADR 0022. `ProductSpecification` is tenant-plane and
 * marketplace-admin-service writes it; `ProductBrand` and `ProductCategory` are
 * the platform-plane vocabulary a marketplace has to *merge*, so they moved to
 * `catalog-reference` in marketplace-service. Pointing both at one domain key is
 * how the brand and category pages ended up requesting routes that no longer
 * existed — the host rewrites each key to its own same-origin proxy.
 */
/** marketplace-admin-service: a vendor's specifications, offerings and prices. */
const CATALOG_SERVICE = restOptionsFor('marketplace-admin-service-domain');

const REFERENCE_SERVICE = restOptionsFor('marketplace-service-domain');

/**
 * Builds the full CRUD adapter set for one entity, backed by REST, under the
 * shared {@link EntityRepositoryTag}. Each page merges only the entity context
 * it needs, so the single tag never collides at the point of use. Link
 * resolution is composed per page from these same adapters — see
 * `createEntityLinkResolver`.
 */
function createRestRepositoryContext<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  restOptions: BuildEntityRestOptions,
) {
  return Context.make(EntityRepositoryTag, {
    get: buildEntityRestAdapterGet(entityConstructor, restOptions),
    load: buildEntityRestAdapterLoad(entityConstructor, restOptions),
    save: buildEntityRestAdapterSave(entityConstructor, restOptions),
    delete: buildEntityRestAdapterDelete(entityConstructor, restOptions),
  });
}

const productCategoryRest = createRestRepositoryContext(
  ProductCategory,
  REFERENCE_SERVICE,
);
const productBrandRest = createRestRepositoryContext(
  ProductBrand,
  REFERENCE_SERVICE,
);
const productRest = createRestRepositoryContext(
  ProductSpecification,
  CATALOG_SERVICE,
);
const productOfferingRest = createRestRepositoryContext(
  ProductOffering,
  CATALOG_SERVICE,
);
const productOfferingPriceRest = createRestRepositoryContext(
  ProductOfferingPrice,
  CATALOG_SERVICE,
);

/**
 * The reference vocabulary's affordances and bulk verbs, both through the
 * host's own `/api/marketplace` proxy.
 *
 * A hand-written path rather than the adapters' config-driven `compose` mode,
 * for the same reason the auth shell writes one: these are not entity CRUD
 * calls, so they do not go through `buildEntityRestAdapter*` and there is no
 * `uri` group for them to compose from. The proxy is what keeps a real backend
 * address out of the browser, and what carries the httpOnly cookie upstream —
 * a cross-origin call would answer `401`.
 */
const referenceMetadata = makeEntityMetadataSource({
  url: name => `/api/marketplace/${name}/$metadata`,
});

/**
 * The catalog service's own affordances and entity-bound verbs, through the
 * host's `/api/admin` proxy.
 *
 * The tenant-plane sibling of {@link referenceMetadata}, and a separate
 * constant because the two services sit behind two different proxies — the same
 * split ADR 0022 forced on the adapters one file over.
 */
const catalogMetadata = makeEntityMetadataSource({
  url: name => `/api/admin/${name}/$metadata`,
});

/**
 * Each entity's verbs, through the same proxy and `uri` composition as its
 * adapters: a record's verb is `POST <entity>/:id/<key>` and a collection's
 * `POST <entity>/<key>`, the paths the service derives from each
 * `@useCase()`, and a refusal arrives decoded from its problem body.
 */
const productBrandUseCases = makeEntityRestUseCaseRunner(
  ProductBrand,
  REFERENCE_SERVICE,
);
const productCategoryUseCases = makeEntityRestUseCaseRunner(
  ProductCategory,
  REFERENCE_SERVICE,
);
const productOfferingUseCases = makeEntityRestUseCaseRunner(
  ProductOffering,
  CATALOG_SERVICE,
);

export function createClientAdapters(): MarketplaceAdminAdapters {
  return {
    productCategoryRest,
    productBrandRest,
    productRest,
    productOfferingRest,
    productOfferingPriceRest,
    referenceMetadata,
    catalogMetadata,
    productBrandUseCases,
    productCategoryUseCases,
    productOfferingUseCases,
  };
}
