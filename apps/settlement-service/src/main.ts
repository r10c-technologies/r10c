import { makeService } from '@r10c/shells-effect-service';

import { DEFAULT_PORT, SERVICE_NAME } from './index';
import { AppLayer } from './mongo';
import { router } from './routes';

/**
 * settlement-service — what the platform owes each vendor, and on what terms
 * (port 3107).
 *
 * Owns the `settlement` store: **control** plane, single, one named Mongo
 * database. The one commerce store that is not platform or tenant, because a
 * plane answers *who may read it* and an `Agreement` is the platform's own
 * record about a vendor — the same character as `Entitlement`, and nothing like
 * a public catalog (ADR 0022).
 *
 * ⚠️ **Both of its inputs arrive on the bus, and neither is enough alone.**
 * `payment.captured` says money moved and names the order; `order.placed`
 * carries the vendor-tagged lines and the channel the sale came through. The cut
 * cannot be priced without both, so the two are joined on the order id and
 * whichever completes the pair writes the commission entries
 * ([ADR 0057](../../../docs/adr/0057-settlement-joins-the-sale-to-its-payment.md)).
 *
 * It presents no crossing token and accepts none. Every route is guarded by a
 * verified session, and the reads are narrowed to the caller — a vendor's
 * commission rate is a negotiated term no other vendor may read.
 */
makeService({
  name: SERVICE_NAME,
  port: Number(process.env.PORT) || DEFAULT_PORT,
  slices: ['settlement'],
  router,
  appLayer: AppLayer,
});
