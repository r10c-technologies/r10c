import { createServiceProxyRoute } from '@r10c/shells-next-common/server';
import { TRANSACTION_SERVICE_URL } from '@r10c/shells-next-marketplace-admin/server';

/**
 * Same-origin proxy for transaction-service — the record a browser polls after
 * its `202`, and the reactive stream that tells it when to stop.
 *
 * ⚠️ **A proxy rather than a browser URL change, and ADR 0036 is why.** The
 * stream has to be same-origin by *necessity*, not preference: the session
 * cookie is `httpOnly`, and the `WebSocket` constructor accepts no headers — so
 * an `EventSource` pointed straight at `:3103` would carry no credential and be
 * refused. What moved when the `transaction` slice took `:3103` (#229) is this
 * file's upstream; the path the browser opens is unchanged.
 *
 * These routes used to sit behind `/api/admin`, where marketplace-admin-service
 * served them while the slice was co-deployed there. That address was never the
 * contract — the catalog's `202` link is relative, so no client ever encoded
 * either arrangement.
 */

/**
 * `GET /api/transaction/events` is an open `text/event-stream`, so this handler
 * must never be treated as a static or cached response.
 */
export const dynamic = 'force-dynamic';

const forward = createServiceProxyRoute({
  baseUrl: TRANSACTION_SERVICE_URL,
  // ⚠️ **Put the segment back.** The other proxies strip their namespace because
  // it names the *service* and the next segment names the entity —
  // `/api/stock/stock-item` is `stock` then `stock-item`. Here they are the same
  // word, so stripping it forwards `/api/transaction/events` to `/api/events`,
  // which exists nowhere. The symptom is the one this proxy exists to prevent:
  // the stream 404s, a pending write never settles, and every probe stays green.
  pathPrefix: 'transaction',
});

export const GET = forward;
export const POST = forward;
