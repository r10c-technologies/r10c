import type { Entity } from './Entity';

export type EntitySortType = 'asc' | 'desc';

export type EntitySort<TEntity extends Entity> = Record<number, {
    property: keyof TEntity;
    type: EntitySortType;
}>;
