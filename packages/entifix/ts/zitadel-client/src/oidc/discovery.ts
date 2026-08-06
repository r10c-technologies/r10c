import { EntifixConnError } from '@r10c/entifix-ts-core';
import { Effect } from 'effect';

/** The subset of the OIDC discovery document this client uses. */
export interface OidcDiscovery {
  readonly issuer: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly userinfo_endpoint: string;
  readonly end_session_endpoint: string;
  readonly jwks_uri: string;
}

const REQUIRED_FIELDS = [
  'issuer',
  'authorization_endpoint',
  'token_endpoint',
  'userinfo_endpoint',
  'end_session_endpoint',
  'jwks_uri',
] as const;

/**
 * Discovery documents are fetched once per issuer and kept for the process's
 * life.
 *
 * They describe an instance's shape, not its state, so re-fetching per sign-in
 * would put a network round trip on the login path to learn something that
 * cannot have changed. A restart is the invalidation, which is the right
 * granularity for a value that only moves when the identity provider is
 * redeployed.
 */
const cache = new Map<string, Promise<OidcDiscovery>>();

/** Drop the memoised documents. Exists for tests; nothing in production calls it. */
export const clearDiscoveryCache = (): void => {
  cache.clear();
};

const load = async (issuer: string): Promise<OidcDiscovery> => {
  const url = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`${url} answered ${String(response.status)}`);
  }
  const document = (await response.json()) as Partial<OidcDiscovery>;

  // A document missing an endpoint would otherwise surface much later as
  // `fetch(undefined)` in the middle of a sign-in, where the cause is invisible.
  const missing = REQUIRED_FIELDS.filter(field => typeof document[field] !== 'string');
  if (missing.length > 0) {
    throw new Error(`${url} is missing: ${missing.join(', ')}`);
  }
  return document as OidcDiscovery;
};

/** Fetch (or replay) the discovery document for an issuer. */
export const discover = (
  issuer: string,
): Effect.Effect<OidcDiscovery, EntifixConnError> =>
  Effect.tryPromise({
    try: () => {
      const cached = cache.get(issuer);
      if (cached !== undefined) return cached;
      const pending = load(issuer).catch((error: unknown) => {
        // A failed fetch must not be memoised: the identity provider is often
        // simply still booting, and caching the rejection would make the first
        // failed sign-in permanent until the service restarts.
        cache.delete(issuer);
        throw error;
      });
      cache.set(issuer, pending);
      return pending;
    },
    catch: error =>
      new EntifixConnError(
        `cannot read the OIDC discovery document from ${issuer}: ${String(error)}`,
      ),
  });
