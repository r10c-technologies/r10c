import { SearchPage } from '@r10c/shells-next-marketplace/server';

import { requireLocale } from '../locale-param';

/**
 * Dynamic, and correctly so: the answer is the query string. There is nothing
 * to prerender because there is no page until someone types.
 */
export default async function SearchRoute({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const locale = await requireLocale(params);
  const { q } = await searchParams;

  return <SearchPage locale={locale} term={q} />;
}
