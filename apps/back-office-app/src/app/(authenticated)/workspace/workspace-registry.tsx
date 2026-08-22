'use client';

import { type TabKind, TabRegistry } from '@r10c/shells-next-common';
import {
  ProductBrandListClientPage,
  ProductCategoryListClientPage,
  ProductListClientPage,
} from '@r10c/shells-next-marketplace-admin';
import { ConfigurationListClientPage } from '@r10c/shells-next-system-management';

import {
  ENTITY_EDITORS,
  type EntityEditorKey,
  EntityEditorTab,
  isEntityEditorKey,
} from './entity-tab';

/**
 * The catalogs a `catalog:<key>` tab can open — the list client pages.
 *
 * The key is the **entity key**, the same one `ENTITY_EDITORS` and the nav's
 * `workspace:` addresses use. It was `product` here and `product-specification`
 * everywhere else, which is a `catalog:product-specification` that resolves to
 * nothing: the sidebar's open-in-workspace control did nothing at all, and so
 * did the return to the list after saving a product in a tab.
 */
const CATALOGS = {
  'product-specification': {
    titleKey: 'app:admin.nav.products',
    render: () => <ProductListClientPage />,
  },
  'product-brand': {
    titleKey: 'app:admin.nav.brands',
    render: () => <ProductBrandListClientPage />,
  },
  'product-category': {
    titleKey: 'app:admin.nav.categories',
    render: () => <ProductCategoryListClientPage />,
  },
} as const;

type CatalogKey = keyof typeof CATALOGS;

const catalogKind: TabKind<{ key: CatalogKey }> = {
  kind: 'catalog',
  match: payload =>
    payload in CATALOGS ? { key: payload as CatalogKey } : null,
  toParam: addr => addr.key,
  title: (addr, translate) => translate(CATALOGS[addr.key].titleKey),
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
  title: (addr, translate) =>
    `${translate(ENTITY_EDITORS[addr.entityKey].labelKey)} #${addr.id}`,
  render: addr => <EntityEditorTab entityKey={addr.entityKey} id={addr.id} />,
};

/**
 * A `system:<key>` tab — the system-management shell's screens as workspace tabs.
 *
 * The screens come from a `scope:shared` shell, but the *registry* stays here:
 * which tabs a host offers is the host's decision, and a second host may want a
 * different set.
 */
const SYSTEM_SCREENS = {
  configuration: {
    titleKey: 'shell:systemManagement.nav.configuration',
    render: () => <ConfigurationListClientPage />,
  },
} as const;

type SystemKey = keyof typeof SYSTEM_SCREENS;

const systemKind: TabKind<{ key: SystemKey }> = {
  kind: 'system',
  match: payload =>
    payload in SYSTEM_SCREENS ? { key: payload as SystemKey } : null,
  toParam: addr => addr.key,
  title: (addr, translate) => translate(SYSTEM_SCREENS[addr.key].titleKey),
  render: addr => SYSTEM_SCREENS[addr.key].render(),
};

/** The workspace's tab registry. Adding a tab kind is one `register` call. */
export const workspaceRegistry = new TabRegistry()
  .register(catalogKind)
  .register(entityKind)
  .register(systemKind);
