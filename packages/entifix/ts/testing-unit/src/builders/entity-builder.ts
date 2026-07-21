import type { Entity, EntityConstructor } from '@r10c/entifix-ts-core';

export interface EntityBuilder<TEntity extends Entity> {
  /** Produces one instance, overriding the defaults with `overrides`. */
  (overrides?: Partial<TEntity>): TEntity;
  /**
   * Produces `count` instances. `overrides` may be a function of the index, so
   * a list of distinguishable rows takes one line.
   */
  many(
    count: number,
    overrides?: (index: number) => Partial<TEntity>,
  ): TEntity[];
}

/**
 * Builds test entities from a set of defaults.
 *
 * Entities are `#field` + accessor classes, so a literal will not do — every
 * value has to go through its setter for `MetaEntity` introspection and
 * serialization to see it. This keeps that assignment in one place instead of
 * in a `makeWidget` helper redefined in every spec.
 *
 * ```ts
 * const aProduct = defineEntityBuilder(Product, { name: 'Widget', price: 10 });
 * const cheap = aProduct({ price: 1 });
 * const rows = aProduct.many(3, (index) => ({ id: `p-${index}` }));
 * ```
 */
export const defineEntityBuilder = <TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  defaults: Partial<TEntity> = {},
): EntityBuilder<TEntity> => {
  const build = (overrides: Partial<TEntity> = {}): TEntity => {
    const instance = new entityConstructor();
    for (const [property, value] of Object.entries({
      ...defaults,
      ...overrides,
    })) {
      (instance as Record<string, unknown>)[property] = value;
    }
    return instance;
  };

  const builder = build as EntityBuilder<TEntity>;
  builder.many = (count, overrides = () => ({})) =>
    Array.from({ length: count }, (_unused, index) => build(overrides(index)));

  return builder;
};
