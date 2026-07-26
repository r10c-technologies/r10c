/**
 * The locales the fleet ships. `es` is the default and the fallback: a key that
 * is missing from a catalog resolves against Spanish rather than rendering the
 * raw key, so a half-translated `en` degrades to readable text instead of
 * `controls:table.actions`.
 */
export const LOCALES = ['es', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'es';

/**
 * Host-scoped so the choice is shared across the fleet's localhost ports in dev,
 * exactly like `r10c_at`/`r10c_sid`. Written by the locale middleware on every
 * redirect, so a visitor who lands on `/en/...` keeps English on the next visit.
 */
export const LOCALE_COOKIE = 'r10c_locale';

/**
 * Request header the locale middleware sets when it rewrites a prefixed path.
 * Server components read it instead of a route param, which is what lets the
 * route tree stay free of an `app/[locale]` segment.
 */
export const LOCALE_HEADER = 'x-r10c-locale';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}
