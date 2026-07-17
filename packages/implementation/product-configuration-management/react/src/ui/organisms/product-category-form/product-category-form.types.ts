import type { ProductCategory } from '@r10c/business-ts-product-configuration-management';
import type { EntifixError } from '@r10c/entifix-ts-core';

export interface ProductCategoryFormProps {
  /** The record being edited; `undefined` means this is a create. */
  entity?: ProductCategory;
  isLoading?: boolean;
  isSaving?: boolean;
  isDeleting?: boolean;
  error?: EntifixError;
  onSave: (entity: ProductCategory) => void;
  /** Omitted for a create — there is nothing to delete yet. */
  onDelete?: () => void;
  backHref: string;
}
