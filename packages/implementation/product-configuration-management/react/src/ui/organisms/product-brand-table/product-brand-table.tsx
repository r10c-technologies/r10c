import { ProductBrand } from '@r10c/business-ts-product-configuration-management';
import { EntityTable } from '@r10c/entifix-react-controls';
import { useDataLoading } from '@r10c/entifix-react-integration';

import type { ProductBrandTableProps } from './product-brand-table.types';

export function ProductBrandTable({
  ctx,
  uc,
  hrefFor,
  newHref,
}: ProductBrandTableProps) {
  const pager = useDataLoading({
    uc,
    ctx,
  });
  return (
    <EntityTable
      entityConstructor={ProductBrand}
      {...pager}
      hrefFor={hrefFor}
      newHref={newHref}
    />
  );
}
