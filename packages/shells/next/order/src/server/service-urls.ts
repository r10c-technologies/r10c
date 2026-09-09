/**
 * Where order-service listens, server-side.
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
export const ORDER_SERVICE_URL =
  process.env.ORDER_SERVICE_URL ?? 'http://localhost:3105';
