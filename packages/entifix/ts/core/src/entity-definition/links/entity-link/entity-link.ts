import { Effect } from 'effect';

import { EntifixError } from '../../../base-entities/entifix-error';
import { Entity, EntityConstructor, EntityId } from '../../../types/Entity';

/**
 * Framework-free seam a link uses to materialize its target entity. The concrete
 * implementation lives at the composition root (a REST-backed resolver on the
 * web, a Mongo-backed one on the backend) and is injected through Effect's
 * context. Keeping the interface in `core` avoids an upward dependency on the
 * repository contracts defined in `entifix-ts-business`.
 */
export interface EntityLinkResolver {
  resolve<TEntity extends Entity>(
    entityConstructor: EntityConstructor<TEntity>,
    id: EntityId
  ): Effect.Effect<TEntity, EntifixError>;
}

export interface EntityLinkInit<TEntity extends Entity> {
  id?: EntityId;
  value?: TEntity;
}

/**
 * A reference from one entity to another. It models both shapes a raw payload
 * can carry for a relation:
 *
 * - a **foreign key** — only the target id is known, so the entity is fetched
 *   lazily through {@link reload};
 * - **embedded data** — the target already arrived inline and was deserialized
 *   into an instance, so {@link value} is populated and no fetch is needed.
 *
 * Resolution is expressed as an `Effect`, so the same link works in any
 * environment: the caller provides an {@link EntityLinkResolver} backed by
 * whatever adapter (REST, Mongo, …) fits the runtime.
 */
export class EntityLink<TEntity extends Entity> {
  // #region properties
  readonly entityConstructor: EntityConstructor<TEntity>;
  #id: EntityId;
  #value?: TEntity;
  // #endregion

  // #region constructors
  constructor(
    entityConstructor: EntityConstructor<TEntity>,
    init?: EntityLinkInit<TEntity>
  ) {
    this.entityConstructor = entityConstructor;
    this.#id = init?.id;
    this.#value = init?.value;
    if (this.#value !== undefined && this.#id == null) {
      this.#id = this.#value.id;
    }
  }
  // #endregion

  // #region methods
  /**
   * Records the foreign key when the payload only referenced the target by id.
   */
  setId(id: EntityId): void {
    this.#id = id;
  }

  /**
   * Stores an already-materialized target (embedded payload or a completed
   * reload) and keeps the id in sync with it.
   */
  setValue(value: TEntity | undefined): void {
    this.#value = value;
    if (value !== undefined && value.id != null) {
      this.#id = value.id;
    }
  }

  /**
   * Fetches the target through the resolver and caches it on the link. Always
   * hits the resolver — use {@link resolve} to fetch only when not already
   * loaded.
   */
  reload(resolver: EntityLinkResolver): Effect.Effect<TEntity, EntifixError> {
    return resolver
      .resolve(this.entityConstructor, this.#id)
      .pipe(Effect.tap(value => Effect.sync(() => this.setValue(value))));
  }

  /**
   * Returns the cached target if present, otherwise reloads it once.
   */
  resolve(resolver: EntityLinkResolver): Effect.Effect<TEntity, EntifixError> {
    return this.#value !== undefined
      ? Effect.succeed(this.#value)
      : this.reload(resolver);
  }
  // #endregion

  // #region accessors
  get id(): EntityId {
    return this.#id ?? this.#value?.id;
  }

  get value(): TEntity | undefined {
    return this.#value;
  }

  get isLoaded(): boolean {
    return this.#value !== undefined;
  }
  // #endregion
}
