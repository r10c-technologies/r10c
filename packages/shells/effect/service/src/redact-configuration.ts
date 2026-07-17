import { ConfigurationPlain } from '@r10c/entifix-ts-core';

// Matches the `user:password@` credential segment of a connection URI
// (`scheme://user:pass@host...`) so it can be masked in diagnostic output.
const CREDENTIALS_IN_URI = /^([a-z][a-z0-9+.-]*:\/\/)([^:@/]+):([^@/]+)@/i;

/** Masks credentials embedded in a connection-string value, if present. */
export const redactValue = (value: unknown): unknown =>
  typeof value === 'string'
    ? value.replace(CREDENTIALS_IN_URI, '$1***:***@')
    : value;

/**
 * Returns a copy of a {@link ConfigurationPlain} with any connection-string
 * credentials masked — safe to expose from a service's `GET /api/config`
 * introspection endpoint.
 */
export const redactConfiguration = (
  plain: ConfigurationPlain
): ConfigurationPlain => {
  const redacted: ConfigurationPlain = {};
  for (const [group, items] of Object.entries(plain)) {
    redacted[group] = items.map(item => ({
      key: item.key,
      value: redactValue(item.value),
    }));
  }
  return redacted;
};
