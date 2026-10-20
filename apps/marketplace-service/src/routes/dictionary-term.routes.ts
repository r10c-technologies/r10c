import { entityMetadataRoute } from '@entifix/service-shell';
import { DictionaryTerm } from '@r10c/business-ts-catalog-reference';
import { HttpRouter } from 'effect/http';

import {
  byIdRoute,
  deleteRoute,
  guardedWrite,
  listRoute,
  saveRoute,
} from './entity-crud';

/**
 * The characteristic dictionary: platform-owned terms a vendor's specification
 * may resolve a characteristic to, which is what makes two vendors' offerings
 * comparable at all (ADR 0014).
 */
export const dictionaryTermRoutes = HttpRouter.addAll([
  HttpRouter.route('GET', '/api/dictionary-term', listRoute(DictionaryTerm)),
  HttpRouter.route(
    'GET',
    '/api/dictionary-term/:id',
    byIdRoute(DictionaryTerm),
  ),
  // A literal path, and it must stay literal: `/api/:entity/$metadata` would be
  // shadowed by the by-id route above and never run.
  HttpRouter.route(
    'GET',
    '/api/dictionary-term/$metadata',
    entityMetadataRoute(DictionaryTerm),
  ),
  HttpRouter.route(
    'POST',
    '/api/dictionary-term',
    guardedWrite(
      DictionaryTerm,
      'write',
      saveRoute(DictionaryTerm, { fromParams: false }),
    ),
  ),
  HttpRouter.route(
    'PUT',
    '/api/dictionary-term/:id',
    guardedWrite(
      DictionaryTerm,
      'write',
      saveRoute(DictionaryTerm, { fromParams: true }),
    ),
  ),
  HttpRouter.route(
    'DELETE',
    '/api/dictionary-term/:id',
    guardedWrite(DictionaryTerm, 'delete', deleteRoute(DictionaryTerm)),
  ),
]);
