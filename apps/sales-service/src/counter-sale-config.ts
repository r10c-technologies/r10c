import { Context } from 'effect';

/**
 * Where the coordinator answers, and what this service presents to start a
 * flow.
 *
 * Two tags rather than reading configuration inside the route, for the reason
 * every other dial in this fleet is a tag: a route that reached for
 * `ConfigurationRepositoryTag` would make its own failure mode "the row was
 * missing" at request time, where the composition root makes it "the process
 * did not boot".
 */

/** transaction-service's API root — `POST /api/saga/:definition` lives here. */
export class CheckoutCoordinatorUrl extends Context.Tag('CheckoutCoordinatorUrl')<
  CheckoutCoordinatorUrl,
  string
>() {}

/**
 * The coordinator's **inbound** crossing secret.
 *
 * ⚠️ **Not a participant token.** It starts a flow; it does not write a
 * vendor's stock or an order. transaction-service holds those separately, so a
 * leak here cannot reach a tenant store directly
 * ([ADR 0023](../../../docs/adr/0023-service-to-service-tenant-crossing.md)).
 *
 * It is the same secret the storefront's checkout action presents, and this is
 * the second holder of it. The storefront holds it because it has **no session
 * to check** — what it proves is that the fleet is asking. This service holds it
 * for the opposite reason: it *does* have a session, checks
 * `sales-management:sales-channel:sell` against it, and only then acts on the
 * seller's behalf (ADR 0056).
 */
export class CheckoutCrossingToken extends Context.Tag('CheckoutCrossingToken')<
  CheckoutCrossingToken,
  string
>() {}

/** marketplace-service's API root — the published projection is priced from it. */
export class PublishedCatalogUrl extends Context.Tag('PublishedCatalogUrl')<
  PublishedCatalogUrl,
  string
>() {}
