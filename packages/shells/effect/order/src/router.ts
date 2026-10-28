import { productOrderRoutes } from '@r10c/implementation-order-management-http';
import { serviceBaseRoutes } from '@r10c/shells-effect-service';
import { Layer } from 'effect';

/**
 * The `order` slice's routes. `/api/health*` and `/api/$service` are added by
 * the service runtime.
 *
 * Platform plane throughout: the `order` store is single-partitioned and named
 * at boot, so no route here resolves a tenant handle. That is the opposite of
 * stock-service next door, and it is the store's property rather than a choice —
 * one order can span several vendors, so it cannot live in any one of their
 * databases (`docs/_shared/planes.md`).
 */
export const router = Layer.mergeAll(
  serviceBaseRoutes({ service: '@r10c/order-service', store: 'mongo' }),
  productOrderRoutes,
);
