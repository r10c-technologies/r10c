/**
 * Where checkout is started, and what it presents to start it.
 *
 * ⚠️ **Server-only, and that is load-bearing rather than tidy.** The token below
 * is the coordinator's inbound crossing secret; a browser holding it could start
 * a flow that writes an order. Nothing in this module may be imported from a
 * client component, which `checkout-action.ts`'s `'use server'` guarantees for
 * its own caller.
 *
 * Read from the environment at module scope, like every other service address in
 * the fleet, rather than through config-service's client. The storefront's other
 * addresses go through the configuration store because they are *entity* URIs an
 * adapter composes; this is one fixed path and one secret, and routing it
 * through a store would put the secret in a document `GET /api/config` reports.
 */

/** transaction-service's API root, server-side. */
export const checkoutServiceUrl = (): string =>
  process.env['TRANSACTION_SERVICE_URL'] ?? 'http://localhost:3103/api';

/**
 * The token the storefront presents to run a saga.
 *
 * ⚠️ **Not a participant token.** It starts a flow; it does not write a vendor's
 * stock. transaction-service holds those separately, so a leak here cannot reach
 * a tenant store ([ADR 0023](../../../../../../docs/adr/0023-service-to-service-tenant-crossing.md)).
 *
 * The dev default matches config-service's seed. A deployment that has not set
 * the variable is therefore running the documented development secret, which is
 * the same trade every other `*_TOKEN` default in this fleet makes — visible in
 * the seed, and rotated by setting the variable.
 */
export const sagaCrossingToken = (): string =>
  process.env['SAGA_CROSSING_TOKEN'] ?? 'dev-saga-crossing-token-change-me';
