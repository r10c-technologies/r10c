import {
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-catalog-reference';
import { ProductSpecification } from '@r10c/business-ts-product-configuration-management';
import {
  defineRecordSearchSource,
  type RecordSearchSource,
} from '@r10c/shells-next-common/server';

import {
  MARKETPLACE_ADMIN_SERVICE_URL,
  MARKETPLACE_SERVICE_URL,
} from './service-urls';

/**
 * The catalog's records, as sources the palette can search (ADR 0040).
 *
 * They live beside the screens rather than in the base shell, for the reason
 * `AUTH_NAV` does: a base shell naming every domain would hand a second host
 * sources for screens it does not mount. The `basePath` halves of the `href`s
 * are the ones `catalog-crud.tsx` declares, and they must stay in step — a
 * result that routes to a page this host does not serve is a dead end the
 * palette has no way to notice.
 *
 * Two services, not one. `ProductSpecification` is tenant-plane and comes from
 * marketplace-admin-service; `ProductBrand` and `ProductCategory` are the
 * platform-plane vocabulary in `catalog-reference` and come from
 * marketplace-service (ADR 0022). A vendor with no active organization gets a
 * `409` from the first and real answers from the other two, which is why the
 * fan-out reports a degraded source rather than failing the search.
 *
 * `DictionaryTerm` is deliberately absent, though it is served from the same
 * place: the back office has no screen for it, so there is no `href` to declare
 * and a result would have nowhere to go.
 */
export const MARKETPLACE_ADMIN_SEARCH_SOURCES: readonly RecordSearchSource[] = [
  defineRecordSearchSource({
    entityConstructor: ProductSpecification,
    baseUrl: MARKETPLACE_ADMIN_SERVICE_URL,
    searchProperty: 'name',
    labelProperty: 'name',
    sublabelProperty: 'code',
    labelKey: 'entity:product-specification.plural',
    // `/catalog/product`, not `/catalog/product-specification`: the route
    // segment and the entity key differ here, and they have drifted apart once
    // already — a `catalog:product-specification` tab address against a
    // `product` registry key, which resolved to nothing at all.
    href: id => `/catalog/product/${id}`,
  }),
  defineRecordSearchSource({
    entityConstructor: ProductBrand,
    baseUrl: MARKETPLACE_SERVICE_URL,
    searchProperty: 'name',
    labelProperty: 'name',
    sublabelProperty: 'code',
    labelKey: 'entity:product-brand.plural',
    href: id => `/catalog/product-brand/${id}`,
  }),
  defineRecordSearchSource({
    entityConstructor: ProductCategory,
    baseUrl: MARKETPLACE_SERVICE_URL,
    searchProperty: 'name',
    labelProperty: 'name',
    sublabelProperty: 'code',
    labelKey: 'entity:product-category.plural',
    href: id => `/catalog/product-category/${id}`,
  }),
];
