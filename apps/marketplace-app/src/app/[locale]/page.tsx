import { HomePage } from '@r10c/shells-next-marketplace/server';

import { type LocaleRouteProps, requireLocale } from './locale-param';

/**
 * Prerendered, one copy per locale, refreshed every minute. Nothing here reads
 * the request, which is the only reason that is possible.
 *
 * ⚠️ It is prerendered at **build** time too, and the build has no fleet — so
 * the catalog read behind this page is deliberately fail-soft: it answers an
 * empty page and logs rather than throwing, and the first revalidation once the
 * fleet is up fills it in. A minute rather than an hour because that empty
 * window is the whole cost of the arrangement.
 */
export const revalidate = 60;

/**
 * ⚠️ **Empty, and on the page rather than the layout.**
 *
 * Empty because a build machine has no fleet: prerendering home there bakes in
 * an empty catalog that `revalidate` then serves to the first visitor of each
 * locale after every deploy. What it still does is put this route in Next's
 * generated mode, which is what makes an on-demand render *cached* — the same
 * arrangement `/[locale]/p/[offeringId]` uses. Without it the route is plain
 * dynamic and every visit re-renders.
 *
 * On the page because the layout's copy applied to **every** descendant, and
 * `/search` and `/cart` read `searchParams` and `cookies()`: as static
 * candidates they answered `500 DYNAMIC_SERVER_USAGE`. Scoped here it reaches
 * only this route, and the build output stays honest — `● /[locale]`,
 * `ƒ /[locale]/search`, `ƒ /[locale]/cart`.
 */
export function generateStaticParams() {
  return [];
}

export default async function Index({ params }: LocaleRouteProps) {
  return <HomePage locale={await requireLocale(params)} />;
}
