import { ConfigurationPlain } from '@r10c/entifix-ts-core';

// Matches the `user:password@` credential segment of a connection URI
// (`scheme://user:pass@host...`) so it can be masked in diagnostic output.
const CREDENTIALS_IN_URI = /^([a-z][a-z0-9+.-]*:\/\/)([^:@/]+):([^@/]+)@/i;

/** Masks credentials embedded in a connection-string value, if present. */
export const redactValue = (value: unknown): unknown =>
  typeof value === 'string'
    ? value.replace(CREDENTIALS_IN_URI, '$1***:***@')
    : value;

/** What a secret's value is replaced with — its presence stays visible, its content does not. */
const REDACTED = '***';

/**
 * Returns a copy of a {@link ConfigurationPlain} safe to expose from a service's
 * **unauthenticated** `GET /api/config` introspection endpoint.
 *
 * Two rules, and the first one carries the weight:
 *
 * 1. Any item the configuration store flagged `isSecret` is blanked outright.
 *    This is what keeps auth-service's RSA private key — a value that mints
 *    `super-admin` tokens for anyone holding it — off a public endpoint. The
 *    flag comes from the store's own `is_secret` column rather than from a
 *    guess about the key's name, because a heuristic that misses once
 *    publishes a signing key.
 * 2. Connection-string credentials are masked even when unflagged, so a URI
 *    someone forgot to flag still does not leak its password.
 */
export const redactConfiguration = (
  plain: ConfigurationPlain,
): ConfigurationPlain => {
  const redacted: ConfigurationPlain = {};
  for (const [group, items] of Object.entries(plain)) {
    redacted[group] = items.map(item => ({
      key: item.key,
      value: item.isSecret === true ? REDACTED : redactValue(item.value),
      ...(item.isSecret === true ? { isSecret: true } : {}),
    }));
  }
  return redacted;
};
