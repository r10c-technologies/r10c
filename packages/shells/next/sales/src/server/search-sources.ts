import {
  defineRecordSearchSource,
  type RecordSearchSource,
} from '@r10c/shells-next-common/server';

import { SALES_SURFACES, type SalesSurface } from '../sales-surfaces';
import { SALES_SERVICE_URL } from './service-urls';

/**
 * The sales records, as sources the palette can search (ADR 0040).
 *
 * They live beside the screens rather than in the base shell, for the reason
 * the catalog's do: a base shell naming every domain would hand a second host
 * sources for screens it does not mount. The `href`s are built from the very
 * `basePath` the screens are generated at, so a result cannot route to a page
 * this host does not serve.
 *
 * ⚠️ `name` is the only member that can be the label: `defineRecordSearchSource`
 * refuses one that is not sortable, filterable **and** a string at module load,
 * and a channel's other two members are enums.
 */
const searchSourceFor = (surface: SalesSurface): RecordSearchSource =>
  defineRecordSearchSource({
    entityConstructor: surface.entityConstructor,
    baseUrl: SALES_SERVICE_URL,
    searchProperty: surface.searchProperty,
    labelProperty: surface.labelProperty,
    sublabelProperty: surface.sublabelProperty,
    labelKey: surface.entityPluralKey,
    href: id => `${surface.basePath}/${id}`,
  });

export const SALES_SEARCH_SOURCES: readonly RecordSearchSource[] =
  SALES_SURFACES.map(searchSourceFor);
