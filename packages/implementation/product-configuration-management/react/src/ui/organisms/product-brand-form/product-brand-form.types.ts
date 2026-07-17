import type { ProductBrand } from '@r10c/business-ts-product-configuration-management';
import type { EntifixError } from '@r10c/entifix-ts-core';

export interface ProductBrandFormProps {
  /** The record being edited; `undefined` means this is a create. */
  entity?: ProductBrand;
  isLoading?: boolean;
  isSaving?: boolean;
  isDeleting?: boolean;
  error?: EntifixError;
  onSave: (entity: ProductBrand) => void;
  /** Omitted for a create — there is nothing to delete yet. */
  onDelete?: () => void;
  backHref: string;
}
