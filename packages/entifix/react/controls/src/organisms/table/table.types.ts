import type { Entity } from '@r10c/entifix-ts-core';

export interface TableProps<TEntity extends Entity> {
  isLoading: boolean;
  items: Array<TEntity>;
  totalItems: number;
  currentPage: number;
  pageSize: number;
  onPageChange: (newPage: number) => void;
  onPageSizeChange: (newPageSize: number) => void;
}
