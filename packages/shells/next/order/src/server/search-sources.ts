import {
  defineRecordSearchSource,
  type RecordSearchSource,
} from '@entifix/next-shell/server';

import { ORDER_SURFACES, type OrderSurface } from '../order-surfaces';
import { ORDER_SERVICE_URL } from './service-urls';

/**
 * The order records, as sources the palette can search (ADR 0040).
 *
 * They live beside the screens rather than in the base shell, for the reason
 * the catalog's do: a base shell naming every domain would hand a second host
 * sources for screens it does not mount. The `href`s are built from the very
 * `basePath` the screens are generated at, so a result cannot route to a page
 * this host does not serve.
 *
 * An order is searched and named by its number, the one thing about it a
 * person reads out (ADR 0076 §5).
 */
const searchSourceFor = (surface: OrderSurface): RecordSearchSource =>
  defineRecordSearchSource({
    entityConstructor: surface.entityConstructor,
    baseUrl: ORDER_SERVICE_URL,
    searchProperty: surface.searchProperty,
    sublabelProperty: surface.sublabelProperty,
    labelKey: surface.entityPluralKey,
    href: id => `${surface.basePath}/${id}`,
  });

export const ORDER_SEARCH_SOURCES: readonly RecordSearchSource[] =
  ORDER_SURFACES.map(searchSourceFor);
