import { createI18n, DEFAULT_LOCALE, isLocale, type Locale, LOCALE_HEADER, type Namespace } from '@r10c/entifix-ts-i18n';
import { headers } from 'next/headers';

/**
 * The locale the middleware resolved for this request.
 *
 * Read from a header rather than a route param — that is the trade the rewrite
 * strategy makes, and it is why the back-office route trees have no
 * `app/[locale]` segment. Falls back to the fleet default for paths the
 * middleware matcher skips (`/api/health`, `/api/config`), which have no
 * user-facing copy anyway.
 *
 * A header is a **dynamic** request input, so a page that calls this — or
 * {@link getServerT}, which does — can never be prerendered. That is the right
 * trade for an auth-gated app whose every response is personal anyway, and the
 * wrong one for a public storefront: marketplace-app therefore carries a real
 * `[locale]` segment and reads its locale from the route param, through
 * {@link getServerTFor}.
 */
export async function getRequestLocale(): Promise<Locale> {
  const value = (await headers()).get(LOCALE_HEADER);
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/**
 * The request-free counterpart of {@link getServerT}, for a locale the caller
 * already holds — a route param, typically.
 *
 * Re-exported rather than defined here so it sits next to `getServerT` at an
 * app's call sites while still being reachable from packages that may not
 * depend on this one: `layer:shell` forbids same-layer edges, and the
 * storefront shell is precisely the caller that needs it. The implementation
 * lives in `@r10c/entifix-ts-i18n`.
 */
export { getServerTFor } from '@r10c/entifix-ts-i18n';

/**
 * A translate function for a server component. A fresh instance per request,
 * because a module-level singleton would let one visitor's locale leak into
 * another's markup under concurrent rendering.
 */
export async function getServerT(ns?: Namespace) {
  const locale = await getRequestLocale();
  return createI18n(locale).getFixedT(locale, ns ?? null);
}

export type TranslateKey = (
  key: string,
  params?: Record<string, unknown>,
) => string;

/**
 * The server counterpart of the controls package's `useTranslateKey`: resolves
 * keys that are only known at runtime — nav labels held in a route table, an
 * entity's `labelKey`.
 *
 * Separate from {@link getServerT}, which stays strict. This is the one place
 * the typed-key guarantee is traded away on the server, and authored copy must
 * keep going through `getServerT` so a typo stays a compile error.
 */
export async function getServerTranslateKey(
  ns?: Namespace,
): Promise<TranslateKey> {
  const t = await getServerT(ns);
  return t as unknown as TranslateKey;
}
