/**
 * Where the two catalog backends listen, server-side.
 *
 * The catalog is two services since ADR 0022 — marketplace-admin-service owns
 * the tenant-plane `ProductSpecification`, marketplace-service owns the
 * platform-plane vocabulary it is classified in — and this host talks to both.
 *
 * Declared once because more than one server surface needs each address: the
 * same-origin proxies the browser's adapters go through, `GET /api/me`, and the
 * record search fan-out. A second copy of a default is how one of them ends up
 * pointing at a port nothing listens on, with the symptom appearing in whichever
 * surface was not updated.
 *
 * Read at module scope, like every other service address in the fleet. Nothing
 * here reaches the browser: this module ships from `/server`.
 */
export const MARKETPLACE_ADMIN_SERVICE_URL =
  process.env.MARKETPLACE_ADMIN_SERVICE_URL ?? 'http://localhost:3101';

export const MARKETPLACE_SERVICE_URL =
  process.env.MARKETPLACE_SERVICE_URL ?? 'http://localhost:3100';
