import { HttpRouter } from '@effect/platform';
import { StockMovement } from '@r10c/business-ts-stock-management';
import { entityMetadataRoute } from '@r10c/shells-effect-service';

import { byIdRoute, guarded, listRoute } from './entity-crud';
import { recordMovementRoute } from './record-movement';

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
);
