import { CategoryPage } from '@r10c/shells-next-marketplace/server';

import { requireLocale } from '../../locale-param';

/**
 * Dynamic, and there is currently no way around it.
 *
 * The intent was a static unfiltered `/c/lighting` with only `?sort=`/`?page=`
 * costing a render. Next has no such split: awaiting `searchParams` is a
 * dynamic request input, and it opts out the **route**, not the request — so a
 * `generateStaticParams` here would enumerate paths that are never served from
 * a prerender. Partial Prerendering is the feature that would give the static
 * shell with a dynamic hole, and it is deliberately not enabled this iteration.
 *
 * The design is unaffected: sort and page still live entirely in the URL and
 * are still rendered on the server, so there is no client state, no client
 * fetch, and the result is shareable. Only the cache tier differs. Home and the
 * product pages carry the prerendering.
 */
export default async function CategoryRoute({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; category: string }>;
  searchParams: Promise<{ sort?: string; page?: string }>;
}) {
  const locale = await requireLocale(params);
  const { category } = await params;
  const { sort, page } = await searchParams;

  return (
    <CategoryPage locale={locale} code={category} sort={sort} page={page} />
  );
}
