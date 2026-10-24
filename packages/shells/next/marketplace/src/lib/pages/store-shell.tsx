import type { Locale } from '@entifix/core';
import { type ReactNode, Suspense } from 'react';

import { CategoryStrip } from '../chrome/category-strip';
import { StoreFooter } from '../chrome/store-footer';
import { StoreHeader } from '../chrome/store-header';

/**
 * Header + footer around a page's own content.
 *
 * Composed per page rather than in a Next layout, so each page decides what
 * waits on what. It awaits nothing itself: the category links are a cached
 * component behind their own boundary, so the header renders in the static
 * shell and the links stream into it.
 */
export function StoreShell({
  locale,
  searchTerm,
  children,
}: {
  readonly locale: Locale;
  /** What the header's search box shows: the term a search page answers. */
  readonly searchTerm?: string;
  readonly children: ReactNode;
}) {
  return (
    <>
      <StoreHeader
        locale={locale}
        searchTerm={searchTerm}
        categories={
          <Suspense fallback={null}>
            <CategoryStrip locale={locale} />
          </Suspense>
        }
      />
      <main
        id="content"
        className="mx-auto w-full max-w-5xl px-s py-l sm:px-l sm:py-xl"
      >
        {children}
      </main>
      <StoreFooter locale={locale} />
    </>
  );
}
