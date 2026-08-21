import { HttpRouter } from '@effect/platform';
import { DictionaryTerm } from '@r10c/business-ts-catalog-reference';
import { entityMetadataRoute } from '@r10c/shells-effect-service';

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
export const dictionaryTermRoutes = HttpRouter.empty.pipe(
  HttpRouter.get('/api/dictionary-term', listRoute(DictionaryTerm)),
  HttpRouter.get('/api/dictionary-term/:id', byIdRoute(DictionaryTerm)),
  // A literal path, and it must stay literal: `/api/:entity/$metadata` would be
  // shadowed by the by-id route above and never run.
  HttpRouter.get(
    '/api/dictionary-term/$metadata',
    entityMetadataRoute(DictionaryTerm),
  ),
  HttpRouter.post(
    '/api/dictionary-term',
    guardedWrite(
      DictionaryTerm,
      'write',
      saveRoute(DictionaryTerm, { fromParams: false }),
    ),
  ),
  HttpRouter.put(
    '/api/dictionary-term/:id',
    guardedWrite(
      DictionaryTerm,
      'write',
      saveRoute(DictionaryTerm, { fromParams: true }),
    ),
  ),
  HttpRouter.del(
    '/api/dictionary-term/:id',
    guardedWrite(DictionaryTerm, 'delete', deleteRoute(DictionaryTerm)),
  ),
);
