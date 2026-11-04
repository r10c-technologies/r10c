import {
  defineRecordSearchSource,
  type RecordSearchSource,
} from '@entifix/next-shell/server';

import {
  FULFILMENT_SURFACES,
  type FulfilmentSurface,
} from '../fulfilment-surfaces';
import { FULFILMENT_SERVICE_URL } from './service-urls';

/**
 * The shipments, as sources the palette can search (ADR 0040), searched and
 * labelled by the order each one carries. `href` is built from the screen's own
 * `basePath`, so a result cannot route to a page this host does not serve.
 */
const searchSourceFor = (surface: FulfilmentSurface): RecordSearchSource =>
  defineRecordSearchSource({
    entityConstructor: surface.entityConstructor,
    baseUrl: FULFILMENT_SERVICE_URL,
    searchProperty: surface.searchProperty,
    labelProperty: surface.labelProperty,
    sublabelProperty: surface.sublabelProperty,
    labelKey: surface.entityPluralKey,
    href: id => `${surface.basePath}/${id}`,
  });

export const FULFILMENT_SEARCH_SOURCES: readonly RecordSearchSource[] =
  FULFILMENT_SURFACES.map(searchSourceFor);
