import { Table } from '@r10c/entifix-react-controls';
import { useDataLoading } from '@r10c/entifix-react-integration';

import type { ProductBrandTableProps } from './product-brand-table.types';

export function ProductBrandTable({ ctx, uc, hrefFor, newHref }: ProductBrandTableProps) {
  const pager = useDataLoading({
    uc,
    ctx,
  });
  return <Table {...pager} hrefFor={hrefFor} newHref={newHref} />;
}
