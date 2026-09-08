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
  #statusChangedAt?: Date;
  // #endregion

  // #region constructors
  constructor(name = '', specificationId = '') {
    this.#name = name;
    this.#specificationId = specificationId;
  }
  // #endregion

  // #region accessors
  @accessor({
    type: 'id',
    label: 'ID',
    labelKey: 'entity:product-offering.fields.id',
  })
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
   * The `ProductSpecification` this offering sells — the product model, in the
   * same store and the same slice.
   *
   * ⚠️ It is **not** an `EntitySpecification` id. This comment used to say so,
   * and every producer and consumer disagreed with it: the seed derives it from
   * `productTempData`, the authoring form's picker names `ProductSpecification`,
   * and the publication reads it to copy a description, a brand and a category.
   * ADR 0014's versioned, content-hashed specification is a different member
   * this entity does not carry yet, and reading the two as one wires a publish
   * against a store that holds nothing — a `409` for every offering, with every
   * test green.
   *
   * A plain id rather than a link, like `ProductSpecification`'s own brand and
   * category: nothing enforces it, so a deleted specification leaves this
   * dangling, which is why publishing checks it rather than assuming it.
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

  /**
   * Filterable because "what is publishable?" is the publisher's own query.
   *
   * ⚠️ **Not `required`**, and that is the same call ADR 0045 made for
   * `ProductSpecification.code`: this member is **server-owned**. It starts at
   * `draft` and only `publish`/`unpublish` move it — the write path overwrites
   * whatever a form sends — so requiring it demands of the operator a value
   * they do not control. Measured: with `required` set and the field hidden,
   * a create was blocked by a validation error that had no field to render on,
   * so Save did nothing and said nothing. A hidden member keeps its rules.
   */
  @accessor({
    type: 'enum',
    labelKey: 'entity:product-offering.fields.status',
    enumValues: OfferingStatuses,
    enumLabelKey: 'entity:product-offering.values.status',
    filterable: true,
  })
  get status(): OfferingStatus {
    return this.#status;
  }
  set status(value: OfferingStatus) {
    this.#status = value;
  }

  /**
   * When this offering's current `status` was decided — the moment
   * `transitionOffering` stamped, on a publication and a takedown alike.
   *
   * ⚠️ **It exists so a rebuild has something stable to re-emit.** The
   * announcement's id is `<offeringId>:<publishedAt>` and the projection orders
   * on that same moment, so a fleet-wide walk that stamped `now` would not
   * redeliver an announcement — it would mint a *new* publication, overwrite the
   * projection's ordering key, and leave a `catalog.unpublished` emitted a
   * second earlier reading as stale. The offering would then stay on the
   * storefront while the vendor's own screen said it was gone.
   *
   * `statusChangedAt` rather than `publishedAt`, because an unpublish stamps it
   * too: on a withdrawn record the second name would describe the takedown.
   *
   * ⚠️ **Server-owned, and therefore neither `readonly` nor `required`.**
   * `readonly` drops a member from serialization *and* deserialization, so the
   * rebuild would read `undefined` off every stored document; `required` demands
   * of an operator a value they do not control, which is the failure ADR 0047
   * measured on `status` — a hidden field's validation rule still runs, with no
   * input to render the error on. It is hidden from the form instead, and
   * `preserveOfferingLifecycle` keeps a `PUT` from blanking it.
   */
  @accessor({
    type: 'date',
    labelKey: 'entity:product-offering.fields.statusChangedAt',
    sortable: true,
    filterable: true,
  })
  get statusChangedAt(): Date | undefined {
    return this.#statusChangedAt;
  }
  set statusChangedAt(value: Date | undefined) {
    this.#statusChangedAt = value;
  }
  // #endregion
}
