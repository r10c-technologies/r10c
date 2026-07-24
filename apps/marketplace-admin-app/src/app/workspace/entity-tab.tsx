'use client';

import { useTabEntityNav } from '@r10c/shells-next-common';
import {
  ProductBrandSingleViewClientPage,
  ProductCategorySingleViewClientPage,
  ProductSingleViewClientPage,
} from '@r10c/shells-next-marketplace-admin';

export const ENTITY_EDITORS = {
  product: { label: 'Product', Editor: ProductSingleViewClientPage },
  'product-brand': { label: 'Brand', Editor: ProductBrandSingleViewClientPage },
  'product-category': {
    label: 'Category',
    Editor: ProductCategorySingleViewClientPage,
  },
} as const;

export type EntityEditorKey = keyof typeof ENTITY_EDITORS;

export function isEntityEditorKey(value: string): value is EntityEditorKey {
  return value in ENTITY_EDITORS;
}

/**
 * An entity editor hosted in a workspace tab: the same single-view form used by
 * the `/catalog/*` routes, but told its id via props and pointed back at the
 * workspace (the catalog tab) on save/delete instead of a route push.
 */
export function EntityEditorTab({
  entityKey,
  id,
}: {
  entityKey: EntityEditorKey;
  id: string;
}) {
  const nav = useTabEntityNav();
  const { Editor } = ENTITY_EDITORS[entityKey];
  return (
    <Editor
      slug={id}
      onSaved={() => nav.toList(entityKey)}
      onDeleted={() => nav.toList(entityKey)}
    />
  );
}
