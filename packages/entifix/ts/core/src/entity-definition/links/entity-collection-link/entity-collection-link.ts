import { Effect } from 'effect';

import { EntifixError } from '../../../base-entities/entifix-error';
import { Entity, EntityConstructor, EntityId } from '../../../types/Entity';
import { EntityLinkResolver } from '../entity-link';

export interface EntityCollectionLinkInit<TEntity extends Entity> {
  ids?: EntityId[];
  values?: TEntity[];
}

/**
 * A one-to-many reference. Like {@link EntityLink} it accepts either foreign
 * keys (lazy, resolved through an {@link EntityLinkResolver}) or embedded
 * instances, but for a collection of targets.
 */
export class EntityCollectionLink<TEntity extends Entity> {
  // #region properties
  readonly entityConstructor: EntityConstructor<TEntity>;
  #ids: EntityId[];
  #values?: TEntity[];
  // #endregion

  // #region constructors
  constructor(
    entityConstructor: EntityConstructor<TEntity>,
    init?: EntityCollectionLinkInit<TEntity>
  ) {
    this.entityConstructor = entityConstructor;
    this.#values = init?.values;
    this.#ids =
      init?.ids ??
      init?.values
        ?.map(value => value.id)
        .filter((id): id is EntityId => id != null) ??
      [];
  }
  // #endregion

  // #region methods
  setIds(ids: EntityId[]): void {
    this.#ids = ids;
  }

  setValues(values: TEntity[] | undefined): void {
    this.#values = values;
    if (values !== undefined) {
      this.#ids = values
        .map(value => value.id)
        .filter((id): id is EntityId => id != null);
    }
  }

  /**
   * Fetches every referenced target through the resolver and caches the result.
   */
  reload(resolver: EntityLinkResolver): Effect.Effect<TEntity[], EntifixError> {
    return Effect.forEach(
      this.#ids,
      id => resolver.resolve(this.entityConstructor, id),
      { concurrency: 'unbounded' }
    ).pipe(Effect.tap(values => Effect.sync(() => this.setValues(values))));
  }

  resolve(resolver: EntityLinkResolver): Effect.Effect<TEntity[], EntifixError> {
    return this.#values !== undefined
      ? Effect.succeed(this.#values)
      : this.reload(resolver);
  }
  // #endregion

  // #region accessors
  get ids(): EntityId[] {
    return this.#ids;
  }

  get values(): TEntity[] | undefined {
    return this.#values;
  }

  get isLoaded(): boolean {
    return this.#values !== undefined;
  }
  // #endregion
}
