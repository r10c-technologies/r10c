import type { Entity } from './Entity';

export const EntityFilterBinaryOperators = [
    'eq',
    'ne',
    'gt',
    'gte',
    'lt',
    'lte',
] as const;
export type EntityFilterBinaryOperator =
    typeof EntityFilterBinaryOperators[number];
export type EntityFilterBinary<TEntity extends Entity, TKey extends keyof TEntity> = {
    property: TKey;
    operator: EntityFilterBinaryOperator;
    value: TEntity[TKey];
};

export const EntityFilterArrayOperators = ['in', 'nin'] as const;
export type EntityFilterArrayOperator = typeof EntityFilterArrayOperators[number];
export type EntityFilterArray<TEntity extends Entity, TKey extends keyof TEntity> = {
    property: TKey;
    operator: EntityFilterArrayOperator;
    values: Array<TEntity[TKey]>;
};

export const EntityFilterRangeOperators = ['between', 'nbetween'] as const;
export type EntityFilterRangeOperator = typeof EntityFilterRangeOperators[number];
export type EntityFilterRange<TEntity extends Entity, TKey extends keyof TEntity> = {
    property: TKey;
    operator: EntityFilterRangeOperator;
    start: TEntity[TKey];
    end: TEntity[TKey];
};

export const EntityFilterStringOperators = ['like', 'nlike'] as const;
export type EntityFilterStringOperator =
    typeof EntityFilterStringOperators[number];
export type EntityFilterString<TEntity extends Entity> = {
    property: keyof TEntity;
    operator: EntityFilterStringOperator;
    value: string;
};

export const EntityFilterNullOperators = ['isNull', 'isNotNull'] as const;
export type EntityFilterNullOperator = typeof EntityFilterNullOperators[number];
export type EntityFilterNull<TEntity extends Entity, TKey extends keyof TEntity> = {
    property: TKey;
    operator: EntityFilterNullOperator;
};

export type EntityFilter<TEntity extends Entity> =
    | EntityFilterBinary<TEntity, keyof TEntity>
    | EntityFilterArray<TEntity, keyof TEntity>
    | EntityFilterRange<TEntity, keyof TEntity>
    | EntityFilterString<TEntity>
    | EntityFilterNull<TEntity, keyof TEntity>;

export const LogicOperators = ['and', 'or'] as const;
export type LogicOperator = typeof LogicOperators[number];
export type FilterGroup<TEntity extends Entity> = {
    operator: LogicOperator;
    values: Array<EntityFilter<TEntity> | FilterGroup<TEntity>>;
};

export type EntityFiltering<TEntity extends Entity> =
    | EntityFilter<TEntity>
    | Array<EntityFilter<TEntity>>
    | FilterGroup<TEntity>;
