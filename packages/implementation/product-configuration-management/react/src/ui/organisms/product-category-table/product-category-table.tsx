import { Table } from '@r10c/entifix-react-controls';
import { useDataLoading } from '@r10c/entifix-react-integration';

import type { ProductCategoryTableProps } from './product-category-table.types';

export function ProductCategoryTable({ ctx, uc, hrefFor, newHref }: ProductCategoryTableProps) {
  const pager = useDataLoading({
    uc,
    ctx,
  });
  return <Table {...pager} hrefFor={hrefFor} newHref={newHref} />;
}
