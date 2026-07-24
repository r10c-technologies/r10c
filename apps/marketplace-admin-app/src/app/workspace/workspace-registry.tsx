'use client';

import { type TabKind, TabRegistry } from '@r10c/shells-next-common';
import {
  ProductBrandListClientPage,
  ProductCategoryListClientPage,
  ProductListClientPage,
} from '@r10c/shells-next-marketplace-admin';

/** The catalogs a `catalog:<key>` tab can open — the list client pages. */
const CATALOGS = {
  product: { title: 'Products', render: () => <ProductListClientPage /> },
  'product-brand': { title: 'Brands', render: () => <ProductBrandListClientPage /> },
  'product-category': {
    title: 'Categories',
    render: () => <ProductCategoryListClientPage />,
  },
} as const;

type CatalogKey = keyof typeof CATALOGS;

const catalogKind: TabKind<{ key: CatalogKey }> = {
  kind: 'catalog',
  match: payload => (payload in CATALOGS ? { key: payload as CatalogKey } : null),
  toParam: addr => addr.key,
  title: addr => CATALOGS[addr.key].title,
  render: addr => CATALOGS[addr.key].render(),
};

/** The workspace's tab registry. Adding a tab kind is one `register` call. */
export const workspaceRegistry = new TabRegistry().register(catalogKind);
