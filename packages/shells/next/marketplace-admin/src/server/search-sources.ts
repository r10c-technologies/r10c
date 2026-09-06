import {
  defineRecordSearchSource,
  type RecordSearchSource,
} from '@r10c/shells-next-common/server';

import {
  type CatalogService,
  type CatalogSurface,
  MARKETPLACE_ADMIN_CATALOG_SURFACES,
} from '../catalog-surfaces';
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
 * and a result would have nowhere to go — which is why it declares no surface.
 *
 * Derived from the surfaces rather than written out, so a source cannot go
 * missing for an entity the sidebar already offers. The `href`s are built from
 * the very `basePath` the screens are generated at, which closes the drift this
 * file's own comment used to warn about: `/catalog/product` for
 * `product-specification` is stated once now, not agreed on twice.
 */
const SERVICE_URLS: Record<CatalogService, string> = {
  'marketplace-admin': MARKETPLACE_ADMIN_SERVICE_URL,
  marketplace: MARKETPLACE_SERVICE_URL,
};

const searchSourceFor = (surface: CatalogSurface): RecordSearchSource =>
  defineRecordSearchSource({
    entityConstructor: surface.entityConstructor,
    baseUrl: SERVICE_URLS[surface.service],
    searchProperty: surface.searchProperty,
    labelProperty: surface.labelProperty,
    sublabelProperty: surface.sublabelProperty,
    labelKey: surface.entityPluralKey,
    href: id => `${surface.basePath}/${id}`,
  });

export const MARKETPLACE_ADMIN_SEARCH_SOURCES: readonly RecordSearchSource[] =
  MARKETPLACE_ADMIN_CATALOG_SURFACES.map(searchSourceFor);
