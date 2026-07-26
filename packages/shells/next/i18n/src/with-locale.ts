import {
  type Locale,
  LOCALE_COOKIE,
  LOCALE_HEADER,
  localeHref,
  negotiateLocale,
  splitLocalePath,
} from '@r10c/entifix-ts-i18n/routing';
import { type NextRequest, NextResponse } from 'next/server';

export interface LocaleResolution {
  readonly locale: Locale;
  /** The path with its locale segment removed — what the route tree matches on. */
  readonly pathname: string;
  /**
   * Set when the request must be bounced to a prefixed URL first. The caller
   * returns it immediately and skips every other gate: there is nothing to
   * authorize about a URL the visitor is not going to stay on.
   */
  readonly redirect?: NextResponse;
}

/**
 * Resolves the locale for one request, and rewrites the path so the rest of the
 * app never sees the prefix.
 *
 * Two cases:
 *  - **unprefixed** (`/catalog`) — negotiate from cookie then `Accept-Language`,
 *    and redirect to `/<locale>/catalog`. The locale is always visible in the
 *    URL, so a page can be shared or bookmarked in the language it was read in.
 *  - **prefixed** (`/es/catalog`) — take the locale from the segment and hand
 *    back `/catalog`, which the caller rewrites to.
 *
 * A rewrite rather than an `app/[locale]` segment: these apps are dynamic and
 * auth-gated, so a real route segment would buy nothing and cost a `locale`
 * param threaded through every page in three apps.
 */
export function resolveLocale(request: NextRequest): LocaleResolution {
  const { locale: fromPath, rest } = splitLocalePath(request.nextUrl.pathname);

  if (fromPath !== undefined) {
    return { locale: fromPath, pathname: rest };
  }

  const locale = negotiateLocale({
    cookie: request.cookies.get(LOCALE_COOKIE)?.value ?? null,
    acceptLanguage: request.headers.get('accept-language'),
  });

  const target = request.nextUrl.clone();
  target.pathname = localeHref(locale, request.nextUrl.pathname);

  const redirect = NextResponse.redirect(target);
  rememberLocale(redirect, locale);

  return { locale, pathname: request.nextUrl.pathname, redirect };
}

/**
 * Carries the resolved locale to the app: a request header the server
 * components read, and a cookie so the next unprefixed visit skips negotiation.
 * Host-scoped, matching `r10c_at`/`r10c_sid`, so the choice follows the visitor
 * across the fleet's ports in dev.
 */
export function rememberLocale(response: NextResponse, locale: Locale): void {
  response.cookies.set(LOCALE_COOKIE, locale, { path: '/', sameSite: 'lax' });
}

/**
 * Rewrites a prefixed request onto the unprefixed route tree, tagging it with
 * the locale header. Callers that need to run their own gates first can build
 * this themselves from {@link resolveLocale}.
 */
export function rewriteToLocale(
  request: NextRequest,
  resolution: LocaleResolution,
): NextResponse {
  const target = request.nextUrl.clone();
  target.pathname = resolution.pathname;

  const headers = new Headers(request.headers);
  headers.set(LOCALE_HEADER, resolution.locale);

  const response = NextResponse.rewrite(target, { request: { headers } });
  rememberLocale(response, resolution.locale);

  return response;
}
