import { ProductSpecification } from '@r10c/business-ts-product-configuration-management';
import { EntityColumn, EntityTable } from '@r10c/entifix-react-controls';
import { useDataLoading } from '@r10c/entifix-react-integration';
import {
  ConfigurationRepositoryTag,
  EntityRepositoryTag,
} from '@r10c/entifix-ts-business';

import type { ProductTableProps } from './product-table.types';

/**
 * Specification listing. Columns come from `ProductSpecification`'s accessor
 * metadata.
 *
 * `brandId` and `categoryId` are plain ids, not links: their entities live in
 * `catalog-reference`, a platform-plane store owned by another slice, so
 * resolving them here would be a cross-store read the boundary rule forbids
 * ([ADR 0022](../../../../../../../docs/adr/0022-v1-marketplace-module-boundaries.md)).
 * A screen that wants the brand's *name* asks the owning domain for it; this
 * table shows what it holds.
 *
 * `brandId` keeps an `<EntityColumn>` override, which is still the escape hatch
 * for a column whose presentation the metadata cannot express — it renders an
 * em dash rather than an empty cell when the classification is unset.
 */
export function ProductTable({ ctx, uc, hrefFor, newHref }: ProductTableProps) {
  const pager = useDataLoading<
    ProductSpecification,
    EntityRepositoryTag | ConfigurationRepositoryTag
  >({ uc, ctx });

  return (
    <EntityTable
      entityConstructor={ProductSpecification}
      {...pager}
      hrefFor={hrefFor}
      newHref={newHref}
    >
      <EntityColumn<ProductSpecification>
        field="brandId"
        render={product => (
          <span className="font-medium">{product.brandId ?? '—'}</span>
        )}
      />
    </EntityTable>
  );
}
