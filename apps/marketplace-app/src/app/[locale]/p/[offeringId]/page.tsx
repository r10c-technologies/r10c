import {
  productMetadata,
  ProductPage,
} from '@r10c/shells-next-marketplace/server';

import { requireLocale } from '../../locale-param';

/**
 * A blocking route, with no `loading.tsx` (#725). Anything under a Suspense
 * boundary — and a `loading.tsx` is one, for every route below it — arrives in
 * a hidden container that an inline script reveals, so with scripting off the
 * page would be blank. This route is on the buyer's path to an order, which
 * must work without JavaScript, so it renders whole before its first byte.
 */
export const instant = false;

/** Cached on the catalog's lifetime, like the page's own lookup. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; offeringId: string }>;
}) {
  const locale = await requireLocale(params);
  return productMetadata(locale, (await params).offeringId);
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
