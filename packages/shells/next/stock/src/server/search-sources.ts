import {
  defineRecordSearchSource,
  type RecordSearchSource,
} from '@r10c/shells-next-common/server';

import { STOCK_SURFACES, type StockSurface } from '../stock-surfaces';
import { STOCK_SERVICE_URL } from './service-urls';

/**
 * The stock records, as sources the palette can search (ADR 0040).
 *
 * They live beside the screens rather than in the base shell, for the reason
 * the catalog's do: a base shell naming every domain would hand a second host
 * sources for screens it does not mount. The `href`s are built from the very
 * `basePath` the screens are generated at, so a result cannot route to a page
 * this host does not serve.
 *
 * ⚠️ Every source searches and labels by `offeringId`, which is not a style
 * choice: `defineRecordSearchSource` refuses a label member that is not
 * sortable, filterable and a string, **at module load** — and every other
 * member of these three entities is a number or an enum. Searching stock means
 * searching by the offering it belongs to, which is also how a vendor thinks
 * about it.
 */
const searchSourceFor = (surface: StockSurface): RecordSearchSource =>
  defineRecordSearchSource({
    entityConstructor: surface.entityConstructor,
    baseUrl: STOCK_SERVICE_URL,
    searchProperty: surface.searchProperty,
    labelProperty: surface.labelProperty,
    sublabelProperty: surface.sublabelProperty,
    labelKey: surface.entityPluralKey,
    href: id => `${surface.basePath}/${id}`,
  });

export const STOCK_SEARCH_SOURCES: readonly RecordSearchSource[] =
  STOCK_SURFACES.map(searchSourceFor);
