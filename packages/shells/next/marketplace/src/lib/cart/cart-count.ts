/**
 * The cart badge's count in words (#574), outside the badge's `'use client'`
 * module so the server can translate around {@link COUNT_MARK}: a constant
 * exported from a client module reaches the server as a client reference, not
 * as its value.
 */

/**
 * Where the count goes in the badge's labels. The count is only known in the
 * browser, so the server translates around a mark rather than a number.
 */
export const COUNT_MARK = '%count%';

/** The count in words, one label per plural form, already translated. */
export interface CountLabels {
  readonly one: string;
  readonly other: string;
}

/** The count in words, in the locale's plural form for it. */
export function countInWords(
  count: number,
  locale: string,
  labels: CountLabels,
): string {
  const form = new Intl.PluralRules(locale).select(count);
  return (form === 'one' ? labels.one : labels.other).replace(
    COUNT_MARK,
    String(count),
  );
}
