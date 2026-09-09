import { HttpRouter } from '@effect/platform';
import { Payment } from '@r10c/business-ts-payment-management';
import {
  entityMetadataRoute,
  requireCrossing,
} from '@r10c/shells-effect-service';

import { capturePaymentRoute } from './capture-payment';
import { byIdRoute, guarded, listRoute } from './entity-crud';

/**
 * Payments — platform plane, so no route here resolves a tenant handle.
 *
 * ⚠️ **The write takes a crossing token and no session; the reads take a session
 * and no token.** They are different acts. Taking money is a saga step: the
 * coordinator has already held stock and written an order on the buyer's behalf,
 * and the buyer holds no grant over the capture made for them. Reading a payment
 * is an ordinary authenticated read. Each route accepts exactly one credential,
 * which is the distinction ADR 0023 draws — what it forbids is one *route*
 * taking either, because then the weaker one is the security level.
 *
 * ⚠️ **There is no `PUT` and no `DELETE`, and there will not be.** A capture is
 * the checkout saga's **pivot**: once it commits the flow rolls forward, so
 * there is nothing for a compensation to call. A refund is a new record with its
 * own money movement — ADR 0039's "a refund is not an uncharge" — and it is not
 * served yet.
 *
 * `$metadata` stays a **literal** registered before `/:id`: as
 * `/api/:entity/$metadata` it is shadowed by the by-id route and silently never
 * runs, which reads as "this entity has no metadata" (ADR 0026).
 */
export const paymentRoutes = HttpRouter.empty.pipe(
  HttpRouter.post(
    '/api/payment',
    requireCrossing('payment-management:payment:write')(capturePaymentRoute),
  ),
  HttpRouter.get(
    '/api/payment',
    guarded(Payment, 'read', () => listRoute(Payment)),
  ),
  HttpRouter.get('/api/payment/$metadata', entityMetadataRoute(Payment)),
  HttpRouter.get(
    '/api/payment/:id',
    guarded(Payment, 'read', () => byIdRoute(Payment)),
  ),
);
