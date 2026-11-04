/**
 * Where fulfilment-service listens, server-side — declared once for the
 * same-origin proxy and the record search fan-out, so the two cannot point at
 * different ports. Ships from `/server`; nothing here reaches the browser.
 */
export const FULFILMENT_SERVICE_URL =
  process.env.FULFILMENT_SERVICE_URL ?? 'http://localhost:3110';
