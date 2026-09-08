import { HttpRouter } from '@effect/platform';
import { StockItem } from '@r10c/business-ts-stock-management';
import { entityMetadataRoute } from '@r10c/shells-effect-service';

import { byIdRoute, guarded, listRoute } from './entity-crud';

/**
 * The running availability of a vendor's offerings — tenant plane, so every
 * route goes through `guarded`, which checks the permission *and* binds the
 * request to the caller's organization database.
 *
 * ⚠️ **Read-only, and that is the design.** There is no `POST`, `PUT` or
 * `DELETE` here: `onHand` and `reserved` are moved by `$inc` over the
 * append-only ledger and by a conditional reservation write, never by a save
 * ([ADR 0010](../../../../docs/adr/0010-stock-ledger-reservations-and-concurrency.md)).
 * A save route would be the read-modify-write that record exists to forbid, and
 * it is the one route a metadata-driven CRUD screen would otherwise produce for
 * free from two `type: 'number'` accessors.
 *
 * `$metadata` is the exception every entity makes, for ADR 0026's reason: it
 * describes the *model* rather than tenant data, so it must not resolve a
 * tenant handle and must not answer `409` to a principal who has not picked an
 * organization yet. Its path stays a **literal** — registered as
 * `/api/:entity/$metadata` it would be shadowed by the by-id route below and
 * silently never run, which reads as "this entity has no metadata".
 */
export const stockItemRoutes = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/api/stock-item',
    guarded(StockItem, 'read', () => listRoute(StockItem)),
  ),
  HttpRouter.get('/api/stock-item/$metadata', entityMetadataRoute(StockItem)),
  HttpRouter.get(
    '/api/stock-item/:id',
    guarded(StockItem, 'read', () => byIdRoute(StockItem)),
  ),
);
