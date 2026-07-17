import type { Entity, EntityId } from '@r10c/entifix-ts-core';

export interface TableProps<TEntity extends Entity> {
  isLoading: boolean;
  items: Array<TEntity>;
  totalItems: number;
  currentPage: number;
  pageSize: number;
  onPageChange: (newPage: number) => void;
  onPageSizeChange: (newPageSize: number) => void;
  /**
   * Builds the link to a row's record. Supplied as a function rather than the
   * table routing by itself: this package must not depend on a router, so the
   * caller (a shell page, which does know one) owns the URL shape.
   *
   * Omit it and the actions column is not rendered at all.
   */
  hrefFor?: (id: EntityId) => string;
  /** Link to the create form. Omit and no `New` action is rendered. */
  newHref?: string;
}
