import { paymentRoutes } from '@r10c/implementation-payment-management-http';
import {
  fleetFailurePolicy,
  serviceBaseGroup,
} from '@r10c/shells-effect-service';
import { Layer } from 'effect';

/**
 * The `payment` slice's routes. `/api/health*` and `/api/$service` are added
 * by the service runtime.
 *
 * Platform plane throughout: the `payment` store is single-partitioned and named
 * at boot, so no route here resolves a tenant handle. A payment belongs to an
 * order, and an order can span several vendors — so it could not live in any one
 * of their tenant databases even if it wanted to (`docs/_shared/planes.md`).
 */
export const router = Layer.mergeAll(paymentRoutes);

/** The `payment` slice's endpoints, served as one `HttpApi` by `makeService`. */
export const endpoints = [
  serviceBaseGroup({ service: '@r10c/payment-service', store: 'mongo' }),
] as const;

/** How this slice's endpoints answer and log a failure (ADR 0064). */
export const policy = fleetFailurePolicy;
