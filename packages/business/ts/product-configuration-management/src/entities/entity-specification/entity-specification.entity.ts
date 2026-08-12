import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

/**
 * A **vendor-authored, versioned** product model: the list of characteristics a
 * kind of product carries.
 *
 * It exists so that a vendor's new field is not a platform release. Fixed
 * entities put the operator on the critical path of every onboarding; a
 * specification makes the product model **data**
 * ([ADR 0014](../../../../../../docs/adr/0014-entity-specifications-and-the-characteristic-dictionary.md)).
 *
 * A **released version is immutable**, and that single property is what buys
 * three things at once: February's records stay readable after March's
 * redefinition, a compiled-spec cache never has to be invalidated, and
 * publication can dedupe a spec by content hash instead of copying it per
 * offering. `released` is therefore a one-way door — an edit after release is a
 * new version, never a mutation.
 *
 * This does **not** replace entifix metadata. A specification is itself an
 * ordinary decorated entity, so the designer UI is `EntityTable` + `EntityForm`
 * over it. Never synthesize an `EntityConstructor` at runtime and never branch
 * on specifications inside `packages/entifix`.
 *
 * Tenant plane, `catalog` store.
 */
@entity({
  domain: 'product-configuration-management',
  key: 'entity-specification',
  labelKey: 'entity:entity-specification.label',
  pluralKey: 'entity:entity-specification.plural',
})
export class EntitySpecification implements Entity {
  // #region properties
  #id?: EntityId;
  #name: string;
  #version: number;
  #released = false;
  // #endregion

  // #region constructors
  constructor(name = '', version = 1) {
    this.#name = name;
    this.#version = version;
  }
  // #endregion

  // #region accessors
  @accessor({ labelKey: 'entity:entity-specification.fields.id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:entity-specification.fields.name',
    required: true,
    sortable: true,
    filterable: true,
  })
  get name(): string {
    return this.#name;
  }
  set name(value: string) {
    this.#name = value;
  }

  /** Monotonic per `name`. An offering pins the version it was written under. */
  @accessor({
    type: 'number',
    labelKey: 'entity:entity-specification.fields.version',
    required: true,
    sortable: true,
    filterable: true,
  })
  get version(): number {
    return this.#version;
  }
  set version(value: number) {
    this.#version = value;
  }

  /**
   * Once true, the version is frozen. Filterable because "which versions may an
   * offering pin?" is the authoring UI's own query, and an unreleased draft must
   * not be pinnable.
   */
  @accessor({
    type: 'boolean',
    labelKey: 'entity:entity-specification.fields.released',
    required: true,
    filterable: true,
  })
  get released(): boolean {
    return this.#released;
  }
  set released(value: boolean) {
    this.#released = value;
  }
  // #endregion
}
