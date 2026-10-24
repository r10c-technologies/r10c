import { SearchPage } from '@r10c/shells-next-marketplace/server';

import { requireLocale } from '../locale-param';

/**
 * Dynamic, and correctly so: the answer is the query string — the term, the
 * facets, the sort and the page.
 */
export default async function SearchRoute({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);

  return <SearchPage locale={locale} searchParams={await searchParams} />;
}
