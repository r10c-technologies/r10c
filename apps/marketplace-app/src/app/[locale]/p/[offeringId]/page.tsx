import { ProductPage } from '@r10c/shells-next-marketplace/server';

import { requireLocale } from '../../locale-param';

/**
 * Cached for a minute, then regenerated.
 *
 * ⚠️ **Not an hour.** The interval is the window in which a vendor's
 * publication is invisible to the storefront, and the publish verb is a button
 * a vendor presses and then goes looking for the result. An hour of nothing
 * reads as a broken feature; a minute reads as a cache.
 */
export const revalidate = 60;

/**
 * ⚠️ **Deliberately empty, and the route is still cached.**
 *
 * Enumerating offerings here would fetch marketplace-service during
 * `next build`, and a build machine has no fleet — CI's would fail, and the e2e
 * build that runs before the mock profile would too. `dynamicParams` (the
 * default) renders each page on its first request instead and `revalidate`
 * caches it from there, so what is lost is only the build-time warm-up, which a
 * real deployment could not have had either.
 *
 * The function stays rather than being deleted: it is the one place the
 * decision is legible, and removing it invites the next reader to add
 * enumeration back.
 */
export function generateStaticParams() {
  return [];
}

export default async function ProductRoute({
  params,
}: {
  params: Promise<{ locale: string; offeringId: string }>;
}) {
  const locale = await requireLocale(params);
  const { offeringId } = await params;

  return <ProductPage locale={locale} offeringId={offeringId} />;
}
