import { HttpRouter } from '@effect/platform';
import { Payment, Refund } from '@r10c/business-ts-payment-management';
import {
  entityMetadataRoute,
  requireCrossing,
} from '@r10c/shells-effect-service';

import { capturePaymentRoute } from './capture-payment';
import { byIdRoute, guarded, listRoute } from './entity-crud';
import { refundPaymentRoute } from './refund-payment';

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
 * ⚠️ **There is no `PUT` and no `DELETE` on either entity, and there will not
 * be.** A capture is the checkout saga's **pivot**: once it commits the flow
 * rolls forward, so there is nothing for a compensation to call. A refund is a
 * new record with its own money movement — ADR 0039's "a refund is not an
 * uncharge" — which is why it is `POST /api/refund` and not a status written
 * over the capture it reverses
 * ([ADR 0058](../../../../docs/adr/0058-the-order-after-payment.md)).
 *
 * ⚠️ **`POST /api/refund` is the cancellation saga's pivot, as `POST
 * /api/payment` is the checkout saga's.** Both take a crossing token and no
 * session, for the same reason: the buyer behind a cancellation holds no grant
 * over the money movement made on their behalf.
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
  HttpRouter.post(
    '/api/refund',
    requireCrossing('payment-management:refund:write')(refundPaymentRoute),
  ),
  HttpRouter.get(
    '/api/refund',
    guarded(Refund, 'read', () => listRoute(Refund)),
  ),
  HttpRouter.get('/api/refund/$metadata', entityMetadataRoute(Refund)),
  HttpRouter.get(
    '/api/refund/:id',
    guarded(Refund, 'read', () => byIdRoute(Refund)),
  ),
);
