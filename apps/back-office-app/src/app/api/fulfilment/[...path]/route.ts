import { createServiceProxyRoute } from '@entifix/next-shell/server';
import { FULFILMENT_SERVICE_URL } from '@r10c/shells-next-fulfilment/server';

/**
 * Same-origin proxy for fulfilment-service — a vendor's shipments, their
 * served affordances, and the four verbs that move one.
 *
 * ⚠️ **`GET` and `POST`, and no other method.** `dispatch`, `record-delivery`,
 * `record-refusal` and `record-return` are `POST`s guarded by the permission
 * each `@useCase()` derives, so the session this forwards is exactly the
 * credential they take; the proxy grants nothing, and fulfilment-service
 * verifies the token and its own permission. Everything else upstream — open,
 * hold, release, withdraw, the dispatch step — is a flow's crossing behind a
 * token this host does not hold, and the hold's release is the only `DELETE`;
 * forwarding a method nothing session-guarded serves is a `401` a reader has
 * to go and explain.
 */
const forward = createServiceProxyRoute({
  baseUrl: FULFILMENT_SERVICE_URL,
});

export const GET = forward;
export const POST = forward;
