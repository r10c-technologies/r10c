import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

import {
  type OfferingStatus,
  OfferingStatuses,
} from '../../values/offering-status';

/**
 * The commercial packaging: what is orderable from a catalog, priced and termed.
 *
 * SID separates this from `ProductSpecification` — what a thing *is* — because
 * the two change on different clocks and belong to different people. A
 * specification is definitional; an offering is a commercial decision, and one
 * specification can be offered several ways (a bundle, a regional variant, a
 * subscription) without redefining the thing itself.
 *
 * The skeleton stays **typed**. The storefront prerenders against these members
 * and checkout prices against them, so only *characteristics* are
 * specification-driven — `specificationId` pins the immutable
 * `EntitySpecification` version this offering was authored under, which is what
 * lets February's records stay readable after March's redefinition
 * ([ADR 0014](../../../../../../docs/adr/0014-entity-specifications-and-the-characteristic-dictionary.md)).
 *
 * Price is deliberately elsewhere: see `ProductOfferingPrice`.
 *
 * Tenant plane, `catalog` store.
 */
@entity({
  domain: 'product-configuration-management',
  key: 'product-offering',
  labelKey: 'entity:product-offering.label',
  pluralKey: 'entity:product-offering.plural',
})
export class ProductOffering implements Entity {
  // #region properties
  #id?: EntityId;
  #name: string;
  #specificationId: string;
  #status: OfferingStatus = 'draft';
  // #endregion

  // #region constructors
  constructor(name = '', specificationId = '') {
    this.#name = name;
    this.#specificationId = specificationId;
  }
  // #endregion

  // #region accessors
  @accessor({ labelKey: 'entity:product-offering.fields.id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:product-offering.fields.name',
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

  /**
   * The `EntitySpecification` version this offering was written under. Pinned,
   * not followed: a released version is immutable, which is what lets a
   * compiled-spec cache never invalidate and a publication dedupe a spec by
   * content hash.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:product-offering.fields.specificationId',
    required: true,
    filterable: true,
  })
  get specificationId(): string {
    return this.#specificationId;
  }
  set specificationId(value: string) {
    this.#specificationId = value;
  }

  /** Filterable because "what is publishable?" is the publisher's own query. */
  @accessor({
    type: 'enum',
    labelKey: 'entity:product-offering.fields.status',
    enumValues: OfferingStatuses,
    enumLabelKey: 'entity:product-offering.values.status',
    required: true,
    filterable: true,
  })
  get status(): OfferingStatus {
    return this.#status;
  }
  set status(value: OfferingStatus) {
    this.#status = value;
  }
  // #endregion
}
