import {
  defineRecordSearchSource,
  type RecordSearchSource,
} from '@entifix/next-shell/server';
import { ProductOffering } from '@r10c/business-ts-product-configuration-management';

import { STOCK_SURFACES, type StockSurface } from '../stock-surfaces';
import {
  MARKETPLACE_ADMIN_SERVICE_URL,
  STOCK_SERVICE_URL,
} from './service-urls';

/**
 * The stock records, as sources the palette can search (ADR 0040).
 *
 * They live beside the screens rather than in the base shell, for the reason
 * the catalog's do: a base shell naming every domain would hand a second host
 * sources for screens it does not mount. The `href`s are built from the very
 * `basePath` the screens are generated at, so a result cannot route to a page
 * this host does not serve.
 *
 * Each is searched **through the offering** it is for (#552): the term is
 * matched against the offering's name at marketplace-admin-service, and the
 * positions, movements and holds referring to the matches are listed under
 * that name — a vendor types "taza", never an id.
 */
const searchSourceFor = (surface: StockSurface): RecordSearchSource =>
  defineRecordSearchSource({
    entityConstructor: surface.entityConstructor,
    baseUrl: STOCK_SERVICE_URL,
    searchProperty: surface.searchProperty,
    sublabelProperty: surface.sublabelProperty,
    reference: {
      entityConstructor: ProductOffering,
      baseUrl: MARKETPLACE_ADMIN_SERVICE_URL,
    },
    labelKey: surface.entityPluralKey,
    href: id => `${surface.basePath}/${id}`,
  });

export const STOCK_SEARCH_SOURCES: readonly RecordSearchSource[] =
  STOCK_SURFACES.map(searchSourceFor);
