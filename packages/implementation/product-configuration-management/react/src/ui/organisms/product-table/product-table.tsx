import { Product } from '@r10c/business-ts-product-configuration-management';
import { EntityColumn, EntityTable } from '@r10c/entifix-react-controls';
import { useDataLoading } from '@r10c/entifix-react-integration';
import {
  ConfigurationRepositoryTag,
  EntityLinkResolverTag,
  EntityRepositoryTag,
} from '@r10c/entifix-ts-business';

import type { ProductTableProps } from './product-table.types';

/**
 * Product listing. Columns come from `Product`'s accessor metadata, so both
 * relations render through the same default link cell: `brand` arrives embedded
 * and `category` as a foreign key resolved by the load use-case — a link looks
 * the same to the UI regardless of how it was represented in the payload.
 *
 * `brand` additionally carries an `<EntityColumn>` override, showing the escape
 * hatch for a column whose presentation the metadata cannot express.
 */
export function ProductTable({ ctx, uc, hrefFor, newHref }: ProductTableProps) {
  const pager = useDataLoading<
    Product,
    EntityRepositoryTag | ConfigurationRepositoryTag | EntityLinkResolverTag
  >({ uc, ctx });

  return (
    <EntityTable
      entityConstructor={Product}
      {...pager}
      hrefFor={hrefFor}
      newHref={newHref}
    >
      <EntityColumn<Product>
        field="brand"
        render={product => (
          <span className="font-medium">
            {product.brand.value?.name ?? String(product.brand.id ?? '—')}
          </span>
        )}
      />
    </EntityTable>
  );
}
