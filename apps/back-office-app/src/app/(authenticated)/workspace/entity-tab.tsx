'use client';

import { useEntityDraft, useTabEntityNav } from '@r10c/shells-next-common';
import {
  ProductBrandSingleViewClientPage,
  ProductCategorySingleViewClientPage,
  ProductSingleViewClientPage,
} from '@r10c/shells-next-marketplace-admin';

// The entity's own `@entity({ labelKey })` vocabulary — the same keys the table
// and form resolve, so a tab caption cannot drift from its column header.
export const ENTITY_EDITORS = {
  'product-specification': {
    labelKey: 'entity:product-specification.label',
    Page: ProductSingleViewClientPage,
  },
  'product-brand': {
    labelKey: 'entity:product-brand.label',
    Page: ProductBrandSingleViewClientPage,
  },
  'product-category': {
    labelKey: 'entity:product-category.label',
    Page: ProductCategorySingleViewClientPage,
  },
} as const;

export type EntityEditorKey = keyof typeof ENTITY_EDITORS;

export function isEntityEditorKey(value: string): value is EntityEditorKey {
  return value in ENTITY_EDITORS;
}

/**
 * An entity editor hosted in a workspace tab, with continuous autosave: every
 * field edit is persisted to the address-keyed draft (IndexedDB), the form
 * seeds from that draft on mount so a refresh restores the edit, and the draft
 * is cleared once the real Save or Delete commits.
 *
 * All of that is `useEntityDraft` — one hook, handed to the generated page as a
 * port. It used to be per-entity plumbing (`initialDraft` / `onDraftChange`
 * threaded through the page), which is why brands and categories had no
 * autosave at all: nobody had written their copy of it (#131).
 *
 * The same fact drives the tab's dirty marker and its close confirmation,
 * because `WorkspaceShell` reads the draft store directly.
 *
 * The address is built here and is the third spelling of `entity:<key>:<id>` —
 * `entityKind.toParam` in `workspace-registry.tsx` is the second. #141 rewrites
 * that registry, so the duplication is collapsed there rather than now.
 */
export function EntityEditorTab({
  entityKey,
  id,
}: {
  entityKey: EntityEditorKey;
  id: string;
}) {
  const nav = useTabEntityNav();
  const draft = useEntityDraft(`entity:${entityKey}:${id}`);
  const { Page } = ENTITY_EDITORS[entityKey];

  const done = () => nav.toList(entityKey);

  return <Page slug={id} draft={draft} onSaved={done} onDeleted={done} />;
}
