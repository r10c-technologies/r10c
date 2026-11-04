import type { Entity, EntityId } from '@entifix/core';
import { accessor, entity } from '@entifix/core';

/**
 * A seller as the storefront names it: an organization's id and display name,
 * projected from `organization.announced`.
 *
 * ⚠️ **Never copied into an offering's snapshot.** A publication carries only
 * `vendorId`, for the reason ADR 0049 gives for brand and category names: a
 * copied name freezes into every published record until each is republished,
 * and nothing walks them. The storefront resolves the id here instead, and
 * renders no seller line when the lookup misses — an absent line is honest, a
 * raw id is not (ADR 0061).
 *
 * The projector replaces the record wholesale and orders on
 * {@link PublishedVendor.announcedAt}, so a redelivered older announcement
 * cannot put an old name back.
 *
 * Platform plane, `published-vendor` store.
 */
@entity({
  domain: 'marketplace-vendor',
  key: 'published-vendor',
  labelKey: 'entity:published-vendor.label',
  pluralKey: 'entity:published-vendor.plural',
})
export class PublishedVendor implements Entity {
  // #region properties
  #id?: EntityId;
  #vendorId: string;
  #displayName: string;
  // The epoch, so a record written without a stamp compares as older than
  // every real announcement rather than as newer than all of them.
  #announcedAt = new Date(0);
  #acceptsCod = false;
  #holdsStock = false;
  // #endregion

  // #region constructors
  constructor(vendorId = '', displayName = '') {
    this.#vendorId = vendorId;
    this.#displayName = displayName;
  }
  // #endregion

  // #region accessors
  /** The vendor id itself, so a re-announcement replaces rather than adds. */
  @accessor({
    type: 'id',
    labelKey: 'entity:published-vendor.fields.id',
  })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  /**
   * `Organization.id` — the same value a publication carries as `vendorId`.
   * Filterable because "the sellers on this page" is one `in` query.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:published-vendor.fields.vendorId',
    required: true,
    filterable: true,
  })
  get vendorId(): string {
    return this.#vendorId;
  }
  set vendorId(value: string) {
    this.#vendorId = value;
  }

  /** What the seller line and the seller facet render. Sorted for the facet. */
  @accessor({
    type: 'string',
    labelKey: 'entity:published-vendor.fields.displayName',
    required: true,
    sortable: true,
  })
  get displayName(): string {
    return this.#displayName;
  }
  set displayName(value: string) {
    this.#displayName = value;
  }

  /** The source write's moment, and the projector's ordering key. */
  @accessor({
    type: 'date',
    labelKey: 'entity:published-vendor.fields.announcedAt',
  })
  get announcedAt(): Date {
    return this.#announcedAt;
  }
  set announcedAt(value: Date) {
    this.#announcedAt = value;
  }

  /**
   * Whether this seller ships cash on delivery, as auth-service announced it
   * from the organization's entitlement. A storefront **hint**: the checkout's
   * own `cod-eligible` step is what refuses, and payment-service reads this
   * same record to decide it (ADR 0070).
   */
  @accessor({
    type: 'boolean',
    labelKey: 'entity:published-vendor.fields.acceptsCod',
    filterable: true,
  })
  get acceptsCod(): boolean {
    return this.#acceptsCod;
  }
  set acceptsCod(value: boolean) {
    this.#acceptsCod = value;
  }

  /**
   * Whether a checkout may hold this seller's stock — whether it is
   * provisioned for `stock-management`, as auth-service announced it. Read by
   * the coordinator to state a vendor segment's entitlements itself rather
   * than take the caller's word for them (ADR 0066). Serialized like any
   * member — a hidden one would never reach the projection it is read from.
   */
  @accessor({
    type: 'boolean',
    labelKey: 'entity:published-vendor.fields.holdsStock',
  })
  get holdsStock(): boolean {
    return this.#holdsStock;
  }
  set holdsStock(value: boolean) {
    this.#holdsStock = value;
  }
  // #endregion
}
