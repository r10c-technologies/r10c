import { DEFAULT_LOCALE, isLocale, type Locale } from './locales';

export interface LocalePath {
  /** The locale carried by the path's first segment, if it names one. */
  readonly locale?: Locale;
  /** The path with that segment removed. Always starts with `/`. */
  readonly rest: string;
}

/**
 * Splits `/es/catalog/product` into `{ locale: 'es', rest: '/catalog/product' }`.
 * A path whose first segment is not a locale comes back untouched, which is how
 * the middleware tells "needs a redirect" from "needs a rewrite".
 */
export function splitLocalePath(pathname: string): LocalePath {
  const [, first = '', ...others] = pathname.split('/');
  if (!isLocale(first)) return { rest: pathname === '' ? '/' : pathname };

  const rest = others.join('/');
  return { locale: first, rest: `/${rest}` };
}

/**
 * Prefixes an in-app href with a locale. Absolute URLs and already-prefixed
 * paths are returned as-is so this is safe to apply blindly at every call site
 * — which is the point, since a single unprefixed `href` would bounce the user
 * through a redirect and lose their place.
 */
export function localeHref(locale: Locale, href: string): string {
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(href)) return href;
  if (!href.startsWith('/')) return href;
  if (splitLocalePath(href).locale !== undefined) return href;

  return href === '/' ? `/${locale}` : `/${locale}${href}`;
}

/**
 * Picks the best supported locale out of an `Accept-Language` header, honouring
 * q-values and matching `es-419`/`es-MX` onto `es`. Returns `undefined` when the
 * header names nothing we speak, so the caller can fall through to its default.
 */
export function parseAcceptLanguage(
  header: string | null | undefined,
): Locale | undefined {
  if (!header) return undefined;

  const ranked = header
    .split(',')
    .map(part => {
      const [tag = '', ...params] = part.trim().split(';');
      // A `q` that is present but unparseable makes the entry malformed rather
      // than top-priority — the `NaN` is filtered out below.
      const q = params.find(param => /^\s*q=/i.test(param));

      return {
        tag: tag.trim().toLowerCase(),
        quality: q === undefined ? 1 : Number(q.trim().slice(2)),
      };
    })
    .filter(
      entry =>
        entry.tag !== '' && !Number.isNaN(entry.quality) && entry.quality > 0,
    )
    .sort((left, right) => right.quality - left.quality);

  for (const { tag } of ranked) {
    const base = tag.split('-')[0];
    if (isLocale(base)) return base;
  }

  return undefined;
}

export interface NegotiateLocaleInput {
  readonly pathname?: string;
  readonly cookie?: string | null;
  readonly acceptLanguage?: string | null;
}

/**
 * The one place the precedence lives: an explicit path prefix beats the visitor's
 * remembered choice, which beats what their browser asks for, which beats the
 * fleet default. Pure, so the same function runs in edge middleware, in a server
 * component and in a test.
 */
export function negotiateLocale({
  pathname,
  cookie,
  acceptLanguage,
}: NegotiateLocaleInput): Locale {
  const fromPath =
    pathname === undefined ? undefined : splitLocalePath(pathname).locale;
  if (fromPath !== undefined) return fromPath;
  if (isLocale(cookie)) return cookie;

  return parseAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE;
}
