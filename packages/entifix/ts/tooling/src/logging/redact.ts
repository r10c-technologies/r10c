import type { Attributes, LogRecord } from './types';

/**
 * The canonical scrub list — the same keys the `/api/telemetry` proxy and the
 * Collector gateway processor strip. Kept here so every enforcement point shares
 * one source of truth: a secret never reaches a sink regardless of the path.
 */
export const DEFAULT_REDACT_KEYS: readonly string[] = [
  'authorization',
  'cookie',
  'set-cookie',
  'r10c_at',
  'r10c_sid',
  'password',
  'token',
];

/** The value a redacted attribute is replaced with. */
export const REDACTED = '***';

type AttributeValue = Attributes[string];

const isRedactedKey = (key: string, keys: readonly string[]): boolean => {
  const lower = key.toLowerCase();
  return keys.some(candidate => candidate.toLowerCase() === lower);
};

/** Returns a copy of `attributes` with any matching key's value masked. */
export const redactAttributes = (
  attributes: Attributes,
  keys: readonly string[] = DEFAULT_REDACT_KEYS,
): Attributes => {
  const out: Record<string, AttributeValue> = {};
  for (const [key, value] of Object.entries(attributes)) {
    out[key] = isRedactedKey(key, keys) ? REDACTED : (value as AttributeValue);
  }
  return out;
};

/** Default record redactor: masks sensitive attribute values, keeps the rest. */
export const redactRecord = (
  record: LogRecord,
  keys: readonly string[] = DEFAULT_REDACT_KEYS,
): LogRecord => ({
  ...record,
  attributes: redactAttributes(record.attributes, keys),
});
