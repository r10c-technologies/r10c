/**
 * Where settlement-service listens, server-side.
 *
 * Declared once because more than one server surface needs it: the same-origin
 * proxy the browser's adapters go through, and the record search fan-out. A
 * second copy of a default is how one of them ends up pointing at a port
 * nothing listens on, with the symptom appearing in whichever surface was not
 * updated.
 *
 * Read at module scope, like every other service address in the fleet. Nothing
 * here reaches the browser: this module ships from `/server`.
 */
export const SETTLEMENT_SERVICE_URL =
  process.env.SETTLEMENT_SERVICE_URL ?? 'http://localhost:3107';

/**
 * Where marketplace-service listens: the owner of the published-vendor
 * projection the record search reads to find a vendor's records by the
 * vendor's name (#552). The same variable the catalog shell reads.
 */
export const MARKETPLACE_SERVICE_URL =
  process.env.MARKETPLACE_SERVICE_URL ?? 'http://localhost:3100';
