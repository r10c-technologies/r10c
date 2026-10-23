import type { Locale } from '@entifix/core';
import { ProductCategory } from '@r10c/business-ts-catalog-reference';
import { loadCategories } from '@r10c/implementation-catalog-reference-next';
import type { ReactNode } from 'react';

import { emptyPage, runRead } from '../catalog/catalog-reads';
import { StoreFooter } from '../chrome/store-footer';
import { StoreHeader } from '../chrome/store-header';

/**
 * Header + footer around a page's own content.
 *
 * Composed per page rather than in a Next layout on purpose: the header needs
 * the category list, and a layout that awaited it would push that fetch above
 * every route — including `/cart`, which has nothing to do with categories.
 * Here each page decides, and the streaming boundary stays inside the page.
 */
export async function StoreShell({
  locale,
  children,
}: {
  readonly locale: Locale;
  readonly children: ReactNode;
}) {
  const categories = await runRead(
    ProductCategory,
    loadCategories(),
    emptyPage<ProductCategory>(),
  );

  return (
    <>
      <StoreHeader
        locale={locale}
        categories={categories.items.map(category => ({
          code: category.code,
          name: category.name,
        }))}
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
