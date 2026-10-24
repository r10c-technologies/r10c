import { isLocale, type Locale } from '@entifix/core';

/** A storefront address that names one catalog record. */
export interface CatalogSlug {
  readonly locale: Locale;
  readonly kind: 'product' | 'category';
  /** The offering id or the category code, as the path carries it. */
  readonly key: string;
}

const SLUG = /^\/([^/]+)\/(p|c)\/([^/]+)\/?$/;

/**
 * The catalog record a path names, or `undefined` for every other path —
 * including one whose locale is not one of ours, which the layout 404s on
 * its own.
 */
export const catalogSlug = (pathname: string): CatalogSlug | undefined => {
  const match = SLUG.exec(pathname);
  if (match === null) return undefined;
  const [, locale, kind, key] = match as unknown as [
    string,
    string,
    'p' | 'c',
    string,
  ];
  if (!isLocale(locale)) return undefined;
  return {
    locale,
    kind: kind === 'p' ? 'product' : 'category',
    key: decodeURIComponent(key),
  };
};

/**
 * Whether a record exists: `true`, `false`, or `undefined` when the read
 * itself failed and nobody knows.
 */
export type SlugLookup = (slug: CatalogSlug) => Promise<boolean | undefined>;

export interface SlugMemoOptions {
  /** How long an answer is reused, in milliseconds. */
  readonly ttl: number;
  /** The most answers held; past it the memo starts over. */
  readonly max: number;
  readonly now?: () => number;
}

/**
 * `lookup`, remembered for `ttl`.
 *
 * Only a definite answer is kept: a failed read is asked again next time,
 * so an outage is never remembered as a missing product. And the memo is
 * bounded, because its keys come from whatever paths visitors type — an
 * unbounded map keyed by request input is a memory leak anyone can drive.
 */
export const memoizeSlugLookup = (
  lookup: SlugLookup,
  { ttl, max, now = Date.now }: SlugMemoOptions,
): SlugLookup => {
  const answers = new Map<string, { exists: boolean; at: number }>();

  return async slug => {
    const id = `${slug.kind}:${slug.key}`;
    const held = answers.get(id);
    if (held !== undefined && now() - held.at < ttl) return held.exists;

    const exists = await lookup(slug);
    if (exists !== undefined) {
      if (answers.size >= max) answers.clear();
      answers.set(id, { exists, at: now() });
    }
    return exists;
  };
};
