import type { Locale } from '@entifix/core';
import { Cluster, Text } from '@entifix/react-controls/primitives';
import { ProductCategory } from '@r10c/business-ts-catalog-reference';
import { loadCategoryRoots } from '@r10c/implementation-catalog-reference-next';
import { cacheLife } from 'next/cache';

import { CATALOG_CACHE } from '../catalog/catalog-cache';
import { runRead } from '../catalog/catalog-reads';
import { storePaths } from '../routing/paths';
import { StoreLink } from '../routing/store-link';

/**
 * The header's category links: the roots only (ADR 0062), since a child is
 * reached through its root, whose page lists the whole subtree.
 *
 * Its own cached component, so the header around it is part of every page's
 * static shell and only this list waits on the catalog. Its props are a
 * locale, which is what a cache entry may be keyed by.
 */
export async function CategoryStrip({ locale }: { readonly locale: Locale }) {
  'use cache';
  cacheLife(CATALOG_CACHE);

  const categories = await runRead(ProductCategory, loadCategoryRoots(), []);

  return (
    <Cluster gap="s" as="ul" className="list-none p-0">
      {categories.map(category => (
        <li key={category.code}>
          <StoreLink locale={locale} href={storePaths.category(category.code)}>
            <Text muted>{category.name}</Text>
          </StoreLink>
        </li>
      ))}
    </Cluster>
  );
}
