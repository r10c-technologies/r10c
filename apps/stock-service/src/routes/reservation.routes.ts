import { HttpRouter } from '@effect/platform';
import { Reservation } from '@r10c/business-ts-stock-management';
import { entityMetadataRoute } from '@r10c/shells-effect-service';

import {
  convertReservationRoute,
  releaseReservationRoute,
} from './end-reservation';
import { byIdRoute, crossed, guarded, listRoute } from './entity-crud';
import { takeReservationRoute } from './take-reservation';

/**
 * Holds on a vendor's stock — **the one route surface in the fleet where two
 * different credentials appear, on two different routes.**
 *
 * The `POST` is the platform → tenant crossing: a service token plus
 * `stock-management:reservation:write`, with the organization named explicitly
 * in a header. It accepts **no session**, not even `super-admin`'s
 * ([ADR 0023](../../../../docs/adr/0023-service-to-service-tenant-crossing.md)).
 *
 * The `GET`s are ordinary tenant reads: a vendor's own session, scoped to the
 * organization it names, guarded by `stock-management:reservation:read` — which
 * `admin` already holds because "why did this buyer lose their basket?" is a
 * support question a vendor has to be able to answer.
 *
 * ⚠️ **That is not the two-credentials mistake, and the difference is worth
 * being precise about.** What ADR 0023 forbids is one *route* accepting either
 * credential, because then the weaker one is the security level. Here each route
 * accepts exactly one, and they are different acts: taking a hold on somebody
 * else's stock, and reading the holds against your own. Adding the session as a
 * fallback on the `POST` — or the crossing token as a fallback on the `GET`s —
 * is the thing that would be wrong.
 *
 * There is still no `PUT`, and there never will be: a generic save could rewrite
 * a quantity or an expiry after the fact, which is a hold that never expires
 * granted by its holder. Ending a hold is a **verb** — `DELETE` releases it and
 * `POST …/conversion` converts it to a sale — each with its own transition and
 * its own crossing permission (#227).
 *
 * ⚠️ **Both ending verbs answer `200` when the hold was already gone.** They are
 * the compensations `runSaga` dispatches, delivery is at-least-once, and a
 * compensation that errors on its second delivery strands a saga that had in
 * fact been fully reversed. The body says which happened
 * ([ADR 0052](../../../../docs/adr/0052-the-checkout-saga.md)).
 */
export const reservationRoutes = HttpRouter.empty.pipe(
  HttpRouter.post(
    '/api/reservation',
    crossed('stock-management:reservation:write', () => takeReservationRoute),
  ),
  HttpRouter.get(
    '/api/reservation',
    guarded(Reservation, 'read', () => listRoute(Reservation)),
  ),
  // Literal path, registered before `:id`. As `/api/:entity/$metadata` it would
  // be shadowed by the by-id route and silently never run, which reads as "this
  // entity has no metadata" (ADR 0026).
  HttpRouter.get(
    '/api/reservation/$metadata',
    entityMetadataRoute(Reservation),
  ),
  HttpRouter.get(
    '/api/reservation/:id',
    guarded(Reservation, 'read', () => byIdRoute(Reservation)),
  ),
  // The two ending verbs, on the same crossing as the `POST`: they act on
  // another party's stock for a buyer whose session names no organization, so
  // the organization comes from the header and the caller is proved by a
  // service token. Each is its own permission — a caller that may release a
  // hold is not thereby a caller that may consume the goods.
  HttpRouter.del(
    '/api/reservation/:id',
    crossed(
      'stock-management:reservation:release',
      () => releaseReservationRoute,
    ),
  ),
  HttpRouter.post(
    '/api/reservation/:id/conversion',
    crossed(
      'stock-management:reservation:convert',
      () => convertReservationRoute,
    ),
  ),
);
