import type { Entity } from './Entity';
import type { EntityLoadRequest } from './EntityLoadRequest';

export interface EntityPage<TEntity extends Entity> {
  items: TEntity[];
  total: number;
  request: EntityLoadRequest<TEntity>;
}
