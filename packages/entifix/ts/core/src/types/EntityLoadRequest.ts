import type { Entity } from './Entity';
import type { EntityFiltering } from './EntityFiltering';
import type { EntitySorting } from './EntitySorting';

export interface EntityLoadRequest<TEntity extends Entity = Entity> {
  filtering?: EntityFiltering<TEntity>[];
  sorting?: EntitySorting<TEntity>[];
  page?: number;
  pageSize?: number;
}
