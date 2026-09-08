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

export default async function Index({ params }: LocaleRouteProps) {
  return <HomePage locale={await requireLocale(params)} />;
}
