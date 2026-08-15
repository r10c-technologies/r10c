import type {
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-catalog-reference';
import { ProductSpecification } from '@r10c/business-ts-product-configuration-management';
import type { EntityLinkSourceConfig } from '@r10c/entifix-react-integration';
import type { EntifixError } from '@r10c/entifix-ts-core';

/**
 * The form's serialisable field values — the shape persisted as a draft. Keyed
 * by the entity's accessor names (`code`, `name`, `description`, `brandId`,
 * `categoryId`, the last two carrying plain ids into `catalog-reference`), it is the
 * generic draft `EntityForm`/`useEntityForm` produce, so it round-trips through
 * both without translation.
 */
export type ProductFormDraft = Record<string, string>;

export interface ProductFormProps<TContext> {
  /** The record being edited; `undefined` means this is a create. */
  entity?: ProductSpecification;
  /**
   * Where each classification's picker looks for its targets: the list use-case,
   * the optional get use-case that turns a held id back into a name, the adapter
   * context, and any standing restriction on what may be assigned.
   *
   * The page owns these because it owns the adapters; the form only turns them
   * into sources. Restricting what is assignable is therefore a use-case change,
   * never a UI one — and here the use-cases run against **marketplace-service**,
   * not the admin service, because `catalog-reference` is another slice's store
   * (ADR 0022). Resolving an id therefore goes through that domain's own read
   * path, which is the only legal way across the boundary.
   *
   * Required rather than optional: `useEntityLinkSource` is a hook, and React's
   * hook count has to stay fixed across renders.
   */
  brandLink: EntityLinkSourceConfig<ProductBrand, TContext>;
  categoryLink: EntityLinkSourceConfig<ProductCategory, TContext>;
  isLoading?: boolean;
  isSaving?: boolean;
  isDeleting?: boolean;
  error?: EntifixError;
  onSave: (entity: ProductSpecification) => void;
  /** Omitted for a create — there is nothing to delete yet. */
  onDelete?: () => void;
  backHref: string;
  /** Seed the fields from a persisted draft instead of the entity (workspace). */
  initialDraft?: ProductFormDraft;
  /** Called on every field edit, so the host can autosave a draft. */
  onDraftChange?: (draft: ProductFormDraft) => void;
}
