import { HttpRouter } from '@effect/platform';
import { StockMovement } from '@r10c/business-ts-stock-management';
import { entityMetadataRoute } from '@r10c/shells-effect-service';

import { byIdRoute, crossed, guarded, listRoute } from './entity-crud';
import { recordMovementRoute } from './record-movement';
import { restoreStockRoute } from './restore-stock';

/**
 * The ledger: every quantity change a vendor has recorded, and the one route
 * that writes it.
 *
 * ⚠️ **Append-only — no `PUT`, no `DELETE`.** The ledger is the system of
 * record and `StockItem` is its fold, so an editable or deletable row would
 * make the total unreconcilable against the history that is supposed to explain
 * it. A correction is a *new* movement with `reason: 'adjustment'`, which is
 * what that reason is for.
 *
 * The `POST` is guarded by `stock-movement:write` rather than by a wildcard,
 * and it is deliberately the only write permission any role holds in this
 * domain — see the note in `ROLE_PERMISSIONS`.
 *
 * ⚠️ **`POST /api/stock-restoration` is a second writer of this ledger, and it
 * takes the other credential.** A vendor records their own movements with a
 * session; a cancellation puts goods back through a crossing token and an
 * explicit organization, because the buyer cancelling holds no membership in the
 * vendor they bought from. One route, one credential, each way — what ADR 0023
 * forbids is one *route* accepting either.
 *
 * ⚠️ **It is a separate route rather than a second guard on the one above**, and
 * that is the whole point: its permission is `stock-movement:restore`, so a
 * crossing token can write the one correction a cancellation makes and cannot
 * write a `receipt`, an `adjustment`, or a movement of any sign it likes
 * ([ADR 0058](../../../../docs/adr/0058-the-order-after-payment.md)).
 */
export const stockMovementRoutes = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/api/stock-movement',
    guarded(StockMovement, 'read', () => listRoute(StockMovement)),
  ),
  HttpRouter.get(
    '/api/stock-movement/$metadata',
    entityMetadataRoute(StockMovement),
  ),
  HttpRouter.get(
    '/api/stock-movement/:id',
    guarded(StockMovement, 'read', () => byIdRoute(StockMovement)),
  ),
  HttpRouter.post(
    '/api/stock-movement',
    guarded(StockMovement, 'write', () => recordMovementRoute),
  ),
  HttpRouter.post(
    '/api/stock-restoration',
    crossed('stock-management:stock-movement:restore', () => restoreStockRoute),
  ),
);
