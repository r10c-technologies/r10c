import type { Locale } from '@entifix/core';
import type { ReactNode } from 'react';

import { CategoryStrip } from '../chrome/category-strip';
import { StoreFooter } from '../chrome/store-footer';
import { StoreHeader } from '../chrome/store-header';

/**
 * Header + footer around a page's own content.
 *
 * Composed per page rather than in a Next layout, so each page decides what
 * waits on what. The category links are a cached component rendered **in
 * place**, not behind a boundary of their own: React streams what is under a
 * `Suspense` into a hidden container that an inline script reveals, so with
 * scripting off the header had no category links on any page (#730). Every
 * route that renders this shell blocks instead (`instant = false`), and the
 * links are a cache entry on the catalog's lifetime, so waiting for them
 * costs a cache hit.
 */
export function StoreShell({
  locale,
  searchTerm,
  notice,
  children,
}: {
  readonly locale: Locale;
  /** What the header's search box shows: the term a search page answers. */
  readonly searchTerm?: string;
  /**
   * A notice that reads the request, such as `AddedNotice`, put above the
   * page. Rendered in place for the reason the category links are: a page
   * that blocks has nothing to gain from a hole, and a hole hides its content
   * without script. Optional: the product page has no request to read.
   */
  readonly notice?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <>
      <StoreHeader
        locale={locale}
        searchTerm={searchTerm}
        categories={<CategoryStrip locale={locale} />}
      />
      {/* Focusable by script only, so the header's skip link moves focus here
          rather than just scrolling, and the next Tab starts inside. */}
      <main
        id="content"
        tabIndex={-1}
        className="mx-auto w-full max-w-7xl px-s pt-s pb-l sm:px-l sm:py-xl"
      >
        {notice ?? null}
        {children}
      </main>
      <StoreFooter locale={locale} />
    </>
  );
}
