import type {
  Product,
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-product-configuration-management';
import type { EntifixError } from '@r10c/entifix-ts-core';

/**
 * The form's serialisable field values — the shape persisted as a draft. Keyed
 * by the entity's accessor names (`code`, `name`, `description`, `brand`,
 * `category`, with the relations carrying the target's foreign key), it is the
 * generic draft `EntityForm`/`useEntityForm` produce, so it round-trips through
 * both without translation.
 */
export type ProductFormDraft = Record<string, string>;

export interface ProductFormProps {
  /** The record being edited; `undefined` means this is a create. */
  entity?: Product;
  /** Options for the relation pickers, loaded by the page. */
  brands: ProductBrand[];
  categories: ProductCategory[];
  isLoading?: boolean;
  isSaving?: boolean;
  isDeleting?: boolean;
  error?: EntifixError;
  onSave: (entity: Product) => void;
  /** Omitted for a create — there is nothing to delete yet. */
  onDelete?: () => void;
  backHref: string;
  /** Seed the fields from a persisted draft instead of the entity (workspace). */
  initialDraft?: ProductFormDraft;
  /** Called on every field edit, so the host can autosave a draft. */
  onDraftChange?: (draft: ProductFormDraft) => void;
}
