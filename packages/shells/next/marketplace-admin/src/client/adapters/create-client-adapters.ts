import {
  EntityRepositoryTag,
} from '@entifix/business';
import { Entity, EntityConstructor } from '@entifix/core';
import {
  buildEntityRestAdapterDelete,
  buildEntityRestAdapterGet,
  buildEntityRestAdapterLoad,
  buildEntityRestAdapterSave,
  BuildEntityRestOptions,
  buildTransactionStatusReader,
  ConfigurationClientRestClient,
  makeEntityMetadataSource,
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
// `create: 'command'` because marketplace-admin-service writes a specification
// through the saga: the POST carries a client-minted transaction id and answers
// `202`, not a stored entity. The reference service below is a plain REST write.
export const CATALOG_SERVICE: BuildEntityRestOptions = {
  ...restOptionsFor('marketplace-admin-service-domain'),
  create: 'command',
};
/**
 * The same backend as {@link CATALOG_SERVICE}, on the plain REST create path.
 *
 * `ProductSpecification` needs the command protocol because a Redis sequence
 * assigns its `code` server-side; an offering and its price have no
 * server-owned member, so a `202` here would buy nothing and cost a tracker
 * record per create. Same host, same proxy, different write contract — which is
 * exactly what `BuildEntityRestOptions.create` exists to say.
 */
const CATALOG_SERVICE_REST = restOptionsFor('marketplace-admin-service-domain');

const REFERENCE_SERVICE = restOptionsFor('marketplace-service-domain');

/**
 * transaction-service, which a catalog `202` hands the browser off to.
 *
 * ⚠️ **Its own domain key, not the catalog's.** The tracker used to answer on
 * marketplace-admin-service because the `transaction` slice was co-deployed
 * there; it took `:3103` when ADR 0039's stated trigger fired (#229). Composing
 * its URL from {@link CATALOG_SERVICE} would keep pointing the status read at
 * `/api/admin`, where nothing serves it any more — and the symptom is a write
 * that stays `PENDING` forever rather than an error anyone sees.
 */
const TRANSACTION_SERVICE = restOptionsFor('transaction-service-domain');

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
  CATALOG_SERVICE_REST,
);
const productOfferingPriceRest = createRestRepositoryContext(
  ProductOfferingPrice,
  CATALOG_SERVICE_REST,
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
 * The tracker's status read, built once here so the component that settles
 * optimistic writes holds a port rather than assembling the adapter and its
 * configuration inline.
 */
const transactionStatus = buildTransactionStatusReader(TRANSACTION_SERVICE);

export function createClientAdapters(): MarketplaceAdminAdapters {
  return {
    productCategoryRest,
    productBrandRest,
    productRest,
    productOfferingRest,
    productOfferingPriceRest,
    referenceMetadata,
    catalogMetadata,
    transactionStatus,
  };
}
