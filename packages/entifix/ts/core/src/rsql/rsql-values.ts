/**
 * Characters that would otherwise be read as grammar. A value containing any of
 * them has to be quoted, or the tokenizer would split the expression inside it.
 */
const RESERVED = /[\s;,()'"=!<>\\]/;

/**
 * Writes a value as an RSQL argument. Numbers and booleans go out bare (that is
 * how RSQL is normally read by a human or another implementation); everything
 * else is single-quoted, which is also the only way a value containing a
 * separator can survive the round trip.
 *
 * Dates are written as ISO-8601 — the one lossless textual form, and the one
 * the coercion step parses back.
 */
export function encodeRsqlValue(value: unknown): string {
  if (value === null || value === undefined) return "''";
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) return quote(value.toISOString());

  const text = String(value);
  return text === '' || RESERVED.test(text) ? quote(text) : text;
}

/** Single-quotes a value, escaping the quote and the escape character itself. */
function quote(text: string): string {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}
