import { makeService } from '@r10c/shells-effect-service';

import { DEFAULT_PORT, SERVICE_NAME } from './index';
import { AppLayer } from './mongo';
import { router } from './routes';

/**
 * payment-service — taking money for an order (port 3106).
 *
 * Owns the `payment` store: **platform** plane, single, one named Mongo
 * database. Its own store rather than a corner of `order`, so "which slice
 * writes a payment?" has one answer and a PSP-facing process — webhooks,
 * retries, reconciliation, all of which arrive on someone else's schedule — can
 * be lifted out later without touching orders (ADR 0022).
 *
 * `POST /api/payment` is the checkout saga's **pivot**. Everything before it
 * reverses and nothing after it does, which is why this service is also the one
 * whose command inbox is load-bearing rather than defensive: a redelivered
 * capture is a customer charged twice
 * ([ADR 0054](../../../docs/adr/0054-capture-is-the-pivot-and-the-bus-carries-what-follows.md)).
 */
makeService({
  name: SERVICE_NAME,
  port: Number(process.env.PORT) || DEFAULT_PORT,
  slices: ['payment'],
  router,
  appLayer: AppLayer,
});
