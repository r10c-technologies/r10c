import { Context } from 'effect';

/**
 * Where the saga coordinator answers, and what this service presents to start a
 * flow through it.
 *
 * ⚠️ **order-service is now the third holder of the coordinator's inbound
 * token, and it is also a participant in the flow it starts.** The cycle is
 * deliberate. A cancellation's authority is a buyer's capability or a vendor's
 * session, and both are verifiable only where the order lives — so the check has
 * to happen here, and ADR 0056 puts the authority check where the credential can
 * actually be checked. Letting the coordinator verify the capability instead
 * would hand the digest, the window and the comparison to a process that
 * declares no domain, and would put an order's authorization rule in a slice
 * that must not know what an order is
 * ([ADR 0058](../../../docs/adr/0058-the-order-after-payment.md) §6).
 *
 * ⚠️ **The coordinator's *inbound* token, not this service's own.** The two are
 * separate `is_secret` rows with separate rotations. `ServiceCrossingTokenTag`
 * holds what transaction-service presents *to* this process when it dispatches a
 * step; this holds what this process presents *to* transaction-service to start
 * a flow. One shared value would mean anyone allowed to write an order also held
 * the key that starts any flow in the fleet
 * ([ADR 0023](../../../docs/adr/0023-service-to-service-tenant-crossing.md)).
 *
 * Tags rather than a configuration read inside the route, for the standing
 * reason: a route reaching for `ConfigurationRepositoryTag` makes its own
 * failure mode "the row was missing" at request time, where the composition root
 * makes it "the process did not boot".
 */
export class CancellationCoordinatorUrl extends Context.Tag(
  'CancellationCoordinatorUrl',
)<CancellationCoordinatorUrl, string>() {}

/** The coordinator's inbound crossing secret. See the note above. */
export class CancellationCrossingToken extends Context.Tag(
  'CancellationCrossingToken',
)<CancellationCrossingToken, string>() {}
