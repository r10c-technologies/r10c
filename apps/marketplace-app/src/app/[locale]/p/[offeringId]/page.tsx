import {
  productMetadata,
  ProductPage,
} from '@r10c/shells-next-marketplace/server';

import { requireLocale } from '../../locale-param';

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
