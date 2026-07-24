'use client';

import { type TabKind, TabRegistry } from '@r10c/shells-next-common';
import {
  ProductBrandListClientPage,
  ProductCategoryListClientPage,
  ProductListClientPage,
} from '@r10c/shells-next-marketplace-admin';

import {
  ENTITY_EDITORS,
  type EntityEditorKey,
  EntityEditorTab,
  isEntityEditorKey,
} from './entity-tab';

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

/** An `entity:<key>:<id>` editor tab. */
const entityKind: TabKind<{ entityKey: EntityEditorKey; id: string }> = {
  kind: 'entity',
  match: payload => {
    const separator = payload.indexOf(':');
    if (separator === -1) return null;
    const entityKey = payload.slice(0, separator);
    const id = payload.slice(separator + 1);
    return isEntityEditorKey(entityKey) && id ? { entityKey, id } : null;
  },
  toParam: addr => `${addr.entityKey}:${addr.id}`,
  title: addr => `${ENTITY_EDITORS[addr.entityKey].label} #${addr.id}`,
  render: addr => <EntityEditorTab entityKey={addr.entityKey} id={addr.id} />,
};

/** The workspace's tab registry. Adding a tab kind is one `register` call. */
export const workspaceRegistry = new TabRegistry()
  .register(catalogKind)
  .register(entityKind);
