/**
 * The names of the cookies an entifix application's session travels in.
 *
 * ⚠️ **Constants in one place, deliberately not a runtime option.** Three
 * packages read or write these — the Effect service shell verifies the access
 * token, the Next shell sets and clears all three, and the Playwright helpers
 * seed them — and a Next application runs its middleware, its server and its
 * client as separate bundles, each with its own module state. A prefix a host
 * configured in one bundle would never reach the others: the middleware would
 * look for one name while a route wrote another, and the only symptom is being
 * signed out. So the names are fixed and shared, and every reader imports them
 * from here instead of re-declaring a literal — which is how r10c had five
 * separate copies of `r10c_at` that nothing kept in step
 * ([ADR 0059](../../../../../../docs/adr/0059-entifix-leaves-the-repo.md)).
 *
 * Host-scoped in dev, where localhost shares cookies across ports, so every app
 * and service in a local fleet reads the same session.
 */

/** Short-lived signed access token the services verify. httpOnly. */
export const ACCESS_COOKIE = 'entifix_at';

/** Opaque session id — the revocation handle and the refresh source. httpOnly. */
export const SESSION_COOKIE = 'entifix_sid';

/** Long-lived, opaque device id. Cleared with cookies — that is intended. */
export const DEVICE_COOKIE = 'entifix_did';
