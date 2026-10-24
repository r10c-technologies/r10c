// r10c's locales, declared before anything asks about one (entifix#35).
import '@r10c/business-ts-i18n/locales';

import { resolveLocale } from '@entifix/next-i18n';
import {
  catalogSlug,
  catalogSlugExists,
} from '@r10c/shells-next-marketplace/server';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * The storefront has no auth gate, so this file does two things: it redirects
 * an unprefixed path onto a locale, and it answers `404` for a product or a
 * category that does not exist (below).
 *
 * The other apps rewrite `/es/catalog` onto `/catalog` and carry the locale on
 * a request header. This one has a real `app/[locale]` segment, so the route
 * tree matches the prefixed path directly and there is nothing to rewrite. That
 * is the whole point: a header is a dynamic request input, and reading one
 * would opt every storefront route out of prerendering.
 *
 * The pass-through deliberately does not re-set the locale cookie either. A
 * `Set-Cookie` on an otherwise-static HTML response is what stops a shared
 * cache from serving it, and the redirect branch (inside `resolveLocale`)
 * already persists the choice on the one request that actually made one.
 */
export async function proxy(request: NextRequest) {
  const redirect = resolveLocale(request).redirect;
  if (redirect) return redirect;

  // A product or category address that names nothing answers `404` here,
  // because nowhere later can (#346): under partial prerendering the route's
  // static shell is sent before its page runs, and the status goes with it.
  // The miss is rewritten onto `/[locale]/missing`, a static page whose only
  // content is `notFound()`. A failed read (`undefined`) passes through.
  const slug = catalogSlug(request.nextUrl.pathname);
  if (slug && (await catalogSlugExists(slug)) === false) {
    return NextResponse.rewrite(
      new URL(`/${slug.locale}/missing`, request.url),
      {
        status: 404,
      },
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|api|favicon.ico).*)'],
};
