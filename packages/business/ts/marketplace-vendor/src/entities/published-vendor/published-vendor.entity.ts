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
  labelMember: 'displayName',
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
  #acceptsLink = false;
  #taxId = '';
  #legalName = '';
  #taxRegime = '';
  #establishmentCode = '';
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
    // `filterable` because a reference names this record by `id=in=(…)`
    // (entifix 0030): member metadata is the server-side query allowlist.
    filterable: true,
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

  /**
   * What the seller line and the seller facet render. Sorted for the facet,
   * and filterable because the back office's record search finds a vendor's
   * agreement, ledger and payouts by this name (`displayName=like=`, #552).
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:published-vendor.fields.displayName',
    required: true,
    sortable: true,
    filterable: true,
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
   *
   * It means "provisioned for `shipping-order-management`", which is both
   * "ships" and "takes cash on delivery" today: the product page reads it for
   * both lines, and a storefront checkout naming a seller without it is
   * refused `vendorDoesNotShip` (ADR 0076 §3, §8). If the two ever diverge per
   * seller, this splits into two flags then.
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

  /**
   * Whether this seller takes payment links, as its organization's `admin`
   * set it and auth-service announced it (ADR 0081 §1). A storefront hint the
   * review offers the tender from; the coordinator refuses a link to a seller
   * this says does not take one.
   */
  @accessor({
    type: 'boolean',
    labelKey: 'entity:published-vendor.fields.acceptsLink',
    filterable: true,
  })
  get acceptsLink(): boolean {
    return this.#acceptsLink;
  }
  set acceptsLink(value: boolean) {
    this.#acceptsLink = value;
  }
  /**
   * The seller's NIT, as announced — what the checkout copies onto every order
   * it writes for this seller (ADR 0078 §6). A NIT is printed on every
   * document a seller issues, which is why a public projection may carry it.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:published-vendor.fields.taxId',
    filterable: false,
  })
  get taxId(): string {
    return this.#taxId;
  }
  set taxId(value: string) {
    this.#taxId = value;
  }

  /**
   * The name the seller's documents are issued under.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:published-vendor.fields.legalName',
    filterable: false,
  })
  get legalName(): string {
    return this.#legalName;
  }
  set legalName(value: string) {
    this.#legalName = value;
  }

  /**
   * The seller's `TaxRegime`, which decides how the coordinator breaks the
   * tax out of each price.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:published-vendor.fields.taxRegime',
    filterable: false,
  })
  get taxRegime(): string {
    return this.#taxRegime;
  }
  set taxRegime(value: string) {
    this.#taxRegime = value;
  }

  /**
   * The SAT establishment the seller sells from.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:published-vendor.fields.establishmentCode',
    filterable: false,
  })
  get establishmentCode(): string {
    return this.#establishmentCode;
  }
  set establishmentCode(value: string) {
    this.#establishmentCode = value;
  }
  // #endregion
}
