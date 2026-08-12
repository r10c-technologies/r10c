import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

/**
 * What the storefront queries: a **snapshot** of a vendor's offering, taken at
 * publication.
 *
 * It is deliberately a different entity from `ProductOffering`, not a view of
 * one. The projection **copies rather than links**, for three reasons in order
 * of weight: a platform-plane reader cannot dereference a tenant pointer without
 * the isolation break the plane split exists to prevent; a buyer must see the
 * price that was published, not one edited mid-session; and the storefront's
 * read path becomes immune to a tenant's write load
 * ([ADR 0009](../../../../../../docs/adr/0009-catalog-authoring-and-publication.md)).
 *
 * Flat on purpose. The storefront prerenders per locale with ISR, so a product
 * page should be one read — a normalized shape would trade that for joins the
 * platform plane gains nothing from.
 *
 * **This store is a projection** (`truth: projection-of:catalog`), which means
 * two things that are easy to get wrong. It is never merged into: republishing
 * replaces the record wholesale, because derived data with a partial update path
 * drifts from its source in ways nothing detects. And it must be rebuildable
 * from tenant storage on demand, which is a walk across every organization.
 *
 * The single writer is the `marketplace` slice, consuming `catalog.published`
 * off the bus — not the slice that authored the offering
 * ([ADR 0022](../../../../../../docs/adr/0022-v1-marketplace-module-boundaries.md)).
 *
 * `availableHint` is a **hint and says so in its name**: published data is
 * eventually consistent on purpose, and the checkout reservation is the truth.
 * Do not fix its staleness with a synchronous tenant-plane call from a
 * prerendered page — that ends ISR and still returns a value stale by the time
 * the buyer clicks.
 *
 * Platform plane, `published-catalog` store.
 */
@entity({
  domain: 'marketplace-catalog',
  key: 'published-offering',
  labelKey: 'entity:published-offering.label',
  pluralKey: 'entity:published-offering.plural',
})
export class PublishedOffering implements Entity {
  // #region properties
  #id?: EntityId;
  #offeringId: string;
  #vendorId: string;
  #name: string;
  #amount = 0;
  #currency = '';
  #availableHint = false;
  // #endregion

  // #region constructors
  constructor(offeringId = '', vendorId = '', name = '') {
    this.#offeringId = offeringId;
    this.#vendorId = vendorId;
    this.#name = name;
  }
  // #endregion

  // #region accessors
  @accessor({ labelKey: 'entity:published-offering.fields.id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  /**
   * The tenant-side offering this was projected from. Kept so a republication
   * can replace the right record and a rebuild is idempotent — it is a
   * correlation key, never something a storefront reader dereferences.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:published-offering.fields.offeringId',
    required: true,
    filterable: true,
  })
  get offeringId(): string {
    return this.#offeringId;
  }
  set offeringId(value: string) {
    this.#offeringId = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:published-offering.fields.vendorId',
    required: true,
    filterable: true,
  })
  get vendorId(): string {
    return this.#vendorId;
  }
  set vendorId(value: string) {
    this.#vendorId = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:published-offering.fields.name',
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

  /** Minor units, snapshotted at publication. See `ProductOfferingPrice`. */
  @accessor({
    type: 'number',
    labelKey: 'entity:published-offering.fields.amount',
    required: true,
    sortable: true,
    filterable: true,
  })
  get amount(): number {
    return this.#amount;
  }
  set amount(value: number) {
    this.#amount = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:published-offering.fields.currency',
    required: true,
    filterable: true,
  })
  get currency(): string {
    return this.#currency;
  }
  set currency(value: string) {
    this.#currency = value;
  }

  /** A hint, not a promise. The checkout reservation is the truth. */
  @accessor({
    type: 'boolean',
    labelKey: 'entity:published-offering.fields.availableHint',
    required: true,
    filterable: true,
  })
  get availableHint(): boolean {
    return this.#availableHint;
  }
  set availableHint(value: boolean) {
    this.#availableHint = value;
  }
  // #endregion
}
