import {
  categoryMetadata,
  CategoryPage,
} from '@r10c/shells-next-marketplace/server';

import { requireLocale } from '../../locale-param';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; category: string }>;
}) {
  const locale = await requireLocale(params);
  return categoryMetadata(locale, (await params).category);
}

/**
 * Facets, sort and page live entirely in the URL and are rendered on the
 * server, so there is no client state and no client fetch, and a listing is
 * shareable. Each distinct listing is a cache entry (`OfferingListing`).
 */
export default async function CategoryRoute({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; category: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const { category } = await params;

  return (
    <CategoryPage
      locale={locale}
      code={category}
      searchParams={await searchParams}
    />
  );
}
