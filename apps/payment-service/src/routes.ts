import { paymentRoutes } from '@r10c/implementation-payment-management-http';
import { serviceBaseRoutes } from '@r10c/shells-effect-service';
import { Layer } from 'effect';

/**
 * payment-service routes. `/api/health*` and `/api/$service` are added by the
 * shell.
 *
 * Platform plane throughout: the `payment` store is single-partitioned and named
 * at boot, so no route here resolves a tenant handle. A payment belongs to an
 * order, and an order can span several vendors — so it could not live in any one
 * of their tenant databases even if it wanted to (`docs/_shared/planes.md`).
 */
export const router = Layer.mergeAll(
  // A literal, not `SERVICE_NAME`: `index.ts` re-exports this module, so
  // importing it back would read the constant before it is initialised.
  serviceBaseRoutes({ service: '@r10c/payment-service', store: 'mongo' }),
  paymentRoutes,
);
