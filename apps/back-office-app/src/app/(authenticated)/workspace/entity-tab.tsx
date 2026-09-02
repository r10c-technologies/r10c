'use client';

import {
  type EntityDraft,
  useDraft,
  useTabEntityNav,
} from '@r10c/shells-next-common';
import {
  ProductBrandSingleViewClientPage,
  ProductCategorySingleViewClientPage,
  ProductSingleViewClientPage,
} from '@r10c/shells-next-marketplace-admin';

// The entity's own `@entity({ labelKey })` vocabulary — the same keys the table
// and form resolve, so a tab caption cannot drift from its column header.
export const ENTITY_EDITORS = {
  'product-specification': { labelKey: 'entity:product-specification.label' },
  'product-brand': { labelKey: 'entity:product-brand.label' },
  'product-category': { labelKey: 'entity:product-category.label' },
} as const;

export type EntityEditorKey = keyof typeof ENTITY_EDITORS;

export function isEntityEditorKey(value: string): value is EntityEditorKey {
  return value in ENTITY_EDITORS;
}

/**
 * The product editor in a workspace tab, with continuous autosave: every field
 * edit is persisted to the address-keyed draft (IndexedDB), the form seeds from
 * that draft on mount (so a refresh restores the edit), and the draft is cleared
 * once the real Save commits to the backend.
 */
function ProductEditorTab({ id }: { id: string }) {
  const nav = useTabEntityNav();
  const { draft, setDraft, clearDraft } = useDraft<EntityDraft>(
    `entity:product-specification:${id}`,
  );

  const done = () => {
    clearDraft();
    nav.toList('product-specification');
  };

  return (
    <ProductSingleViewClientPage
      slug={id}
      initialDraft={draft}
      onDraftChange={setDraft}
      onSaved={done}
      onDeleted={done}
    />
  );
}

function CatalogEditorTab({
  entityKey,
  id,
}: {
  entityKey: 'product-brand' | 'product-category';
  id: string;
}) {
  const nav = useTabEntityNav();
  const done = () => nav.toList(entityKey);
  const Editor =
    entityKey === 'product-brand'
      ? ProductBrandSingleViewClientPage
      : ProductCategorySingleViewClientPage;
  return <Editor slug={id} onSaved={done} onDeleted={done} />;
}

/** An entity editor hosted in a workspace tab. */
export function EntityEditorTab({
  entityKey,
  id,
}: {
  entityKey: EntityEditorKey;
  id: string;
}) {
  return entityKey === 'product-specification' ? (
    <ProductEditorTab id={id} />
  ) : (
    <CatalogEditorTab entityKey={entityKey} id={id} />
  );
}
