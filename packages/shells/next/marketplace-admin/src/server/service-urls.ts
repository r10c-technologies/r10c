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

/**
 * Where transaction-service listens, server-side.
 *
 * It sits in this shell rather than one of its own because the surface that
 * needs it is the catalog's: a `202` from a catalog write is what the browser
 * then watches, through the same-origin `/api/transaction` proxy. The
 * `transaction` slice owns no domain and mounts no screens, so a
 * `shells-next-transaction` package would hold this constant and nothing else.
 *
 * ⚠️ `:3103`, not `:3101`. The slice moved to its own process when ADR 0039's
 * stated trigger fired (#229) — a wrong value here shows up as a write that
 * stays `PENDING` forever while every probe stays green.
 */
export const TRANSACTION_SERVICE_URL =
  process.env.TRANSACTION_SERVICE_URL ?? 'http://localhost:3103';
