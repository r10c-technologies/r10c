import type { Entity, EntityId } from '@entifix/core';
import { accessor, entity } from '@entifix/core';
import {
  MediaReference,
  type MediaReferenceValue,
  PriceTierRow,
} from '@r10c/business-ts-catalog-contracts';
import {
  DEFAULT_PRICE_PER,
  DEFAULT_SALE_UNIT,
  oneWholeUnit,
  type PricePer,
  type PriceTier,
  SALE_UNIT_NAME_KEY,
  SALE_UNIT_SCALES,
  SALE_UNIT_SYMBOL_KEY,
  type SaleUnit,
  SaleUnits,
} from '@r10c/business-ts-sales-vocabulary';

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
  #saleUnit: SaleUnit = DEFAULT_SALE_UNIT;
  #quantityStep = oneWholeUnit(DEFAULT_SALE_UNIT);
  #quantityMinimum = oneWholeUnit(DEFAULT_SALE_UNIT);
  #pricePer: PricePer = DEFAULT_PRICE_PER;
  #tiers?: readonly PriceTier[];
  #stockOfferingId?: string;
  #stockFactor?: number;
  #stockUnit?: SaleUnit;
  #amountPerThousand = 0;
  // The epoch, so a record written before this member existed compares as
  // older than every real publication rather than as newer than all of them.
  #publishedAt = new Date(0);
  // The merchandising members, and every one of them is optional because its
  // source is: three are `string | undefined` on `ProductSpecification`, and
  // `code` is blanked by a `PUT` that omits it. They are deliberately not
  // constructor parameters — the projector assigns through setters, and a
  // seven-argument constructor would destroy the readable trio below.
  #specificationId?: string;
  #specificationVersion?: number;
  #code?: string;
  #description?: string;
  #brandId?: string;
  #categoryId?: string;
  #media?: readonly MediaReferenceValue[];
  #fitsDeviceModelIds?: readonly string[];
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

  /**
   * Minor units, snapshotted at publication: what `pricePer` whole `saleUnit`s
   * cost. See `ProductOfferingPrice`.
   *
   * ⚠️ **Neither sortable nor filterable.** Q7.50 the hundred is `750`, and
   * ordering it beside Q7.50 each would rank it a hundred times too dear;
   * {@link PublishedOffering.amountPerThousand} is what a list orders and
   * filters prices by (ADR 0082 §5).
   */
  @accessor({
    type: 'number',
    labelKey: 'entity:published-offering.fields.amount',
    money: { unit: 'minor', currencyMember: 'currency' },
    required: true,
    sortable: false,
    filterable: false,
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

  /**
   * How many whole `saleUnit`s `amount` buys: `1`, `100` or `1000`, as the
   * vendor quoted it.
   */
  @accessor({
    type: 'number',
    labelKey: 'entity:published-offering.fields.pricePer',
    required: true,
  })
  get pricePer(): PricePer {
    return this.#pricePer;
  }
  set pricePer(value: PricePer) {
    this.#pricePer = value;
  }

  /**
   * Where the price steps down by quantity, as published (ADR 0082 §8): the
   * product page shows the table and a line is charged `tieredPrice` over
   * these and `amount`. Absent, never `[]`, when there are none. Neither
   * sortable nor filterable: a list orders by the base price.
   */
  @accessor({
    type: 'composition',
    childType: () => PriceTierRow,
    labelKey: 'entity:published-offering.fields.tiers',
  })
  get tiers(): readonly PriceTier[] | undefined {
    return this.#tiers;
  }
  set tiers(value: readonly PriceTier[] | undefined) {
    this.#tiers = value;
  }

  /**
   * What a thousand whole units cost, in minor units: the one key prices
   * quoted per one, per hundred and per thousand compare on (ADR 0082 §5).
   * Derived at projection by `amountPerThousand`, never authored. Not
   * `hidden`, which would drop it from the stored document the sort reads; a
   * buyer still reads the price as the vendor quoted it, because no
   * storefront surface renders this member.
   */
  @accessor({
    type: 'number',
    labelKey: 'entity:published-offering.fields.amountPerThousand',
    required: true,
    sortable: true,
    filterable: true,
  })
  get amountPerThousand(): number {
    return this.#amountPerThousand;
  }
  set amountPerThousand(value: number) {
    this.#amountPerThousand = value;
  }

  /**
   * What one of this offering is, and how a buyer may ask for it: in steps of
   * `quantityStep`, from `quantityMinimum`, both in the unit's scale (ADR 0082
   * §1, §3). Copied from the publication, so the storefront checks a quantity
   * against the terms it shows.
   */
  @accessor({
    type: 'enum',
    labelKey: 'entity:published-offering.fields.saleUnit',
    enumValues: SaleUnits,
    enumLabelKey: SALE_UNIT_NAME_KEY,
    required: true,
  })
  get saleUnit(): SaleUnit {
    return this.#saleUnit;
  }
  set saleUnit(value: SaleUnit) {
    this.#saleUnit = value;
  }

  @accessor({
    type: 'number',
    labelKey: 'entity:published-offering.fields.quantityStep',
    required: true,
    scaled: {
      unitMember: 'saleUnit',
      units: SALE_UNIT_SCALES,
      unitLabelKey: SALE_UNIT_SYMBOL_KEY,
    },
  })
  get quantityStep(): number {
    return this.#quantityStep;
  }
  set quantityStep(value: number) {
    this.#quantityStep = value;
  }

  @accessor({
    type: 'number',
    labelKey: 'entity:published-offering.fields.quantityMinimum',
    required: true,
    scaled: {
      unitMember: 'saleUnit',
      units: SALE_UNIT_SCALES,
      unitLabelKey: SALE_UNIT_SYMBOL_KEY,
    },
  })
  get quantityMinimum(): number {
    return this.#quantityMinimum;
  }
  set quantityMinimum(value: number) {
    this.#quantityMinimum = value;
  }

  /**
   * A presentation's base offering, how much of the base's stock one of it
   * takes, and the base's unit, as published (ADR 0082 §7). The sale's line
   * carries all three, so the coordinator reserves on the base; the product
   * page says what one holds. Absent on an offering that draws on no base.
   */
  @accessor({
    references: { entity: 'marketplace-catalog:published-offering' },
    type: 'string',
    labelKey: 'entity:published-offering.fields.stockOfferingId',
    filterable: true,
  })
  get stockOfferingId(): string | undefined {
    return this.#stockOfferingId;
  }
  set stockOfferingId(value: string | undefined) {
    this.#stockOfferingId = value;
  }

  @accessor({
    type: 'number',
    labelKey: 'entity:published-offering.fields.stockFactor',
    sortable: false,
    filterable: false,
    scaled: {
      unitMember: 'stockUnit',
      units: SALE_UNIT_SCALES,
      unitLabelKey: SALE_UNIT_SYMBOL_KEY,
    },
  })
  get stockFactor(): number | undefined {
    return this.#stockFactor;
  }
  set stockFactor(value: number | undefined) {
    this.#stockFactor = value;
  }

  @accessor({
    type: 'enum',
    labelKey: 'entity:published-offering.fields.stockUnit',
    enumValues: SaleUnits,
    enumLabelKey: SALE_UNIT_NAME_KEY,
  })
  get stockUnit(): SaleUnit | undefined {
    return this.#stockUnit;
  }
  set stockUnit(value: SaleUnit | undefined) {
    this.#stockUnit = value;
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

  /**
   * When the publication this record came from was decided.
   *
   * ⚠️ **This is the projection's write guard, not a display field.** Delivery
   * is at-least-once, so a redelivered `catalog.unpublished` can arrive after a
   * newer `catalog.published` and delete a listing that is legitimately live —
   * permanently, silently, and with every probe green. The projector compares
   * this member and ignores an event older than the record it holds, which is
   * what makes the register's `dedupe: 'natural'` claim true rather than merely
   * written down: a full-document upsert really is idempotent, but a *delete*
   * is not, and ordering is what separates them.
   *
   * Written from the event's own `publishedAt`, never from the projector's
   * clock — the receiving time would order messages by when the broker happened
   * to deliver them, which is the thing being defended against.
   */
  @accessor({
    type: 'date',
    labelKey: 'entity:published-offering.fields.publishedAt',
    required: true,
    sortable: true,
    filterable: true,
  })
  get publishedAt(): Date {
    return this.#publishedAt;
  }
  set publishedAt(value: Date) {
    this.#publishedAt = value;
  }

  /**
   * The specification version the offering was published on, and its number
   * (ADR 0079 §2): what a sale copies onto its line, so the order names the
   * frozen version it sold rather than whatever the vendor says today.
   * Neither is queryable — nothing lists by version.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:published-offering.fields.specificationId',
    sortable: false,
    filterable: false,
  })
  get specificationId(): string | undefined {
    return this.#specificationId;
  }
  set specificationId(value: string | undefined) {
    this.#specificationId = value;
  }

  @accessor({
    type: 'number',
    labelKey: 'entity:published-offering.fields.specificationVersion',
    sortable: false,
    filterable: false,
  })
  get specificationVersion(): number | undefined {
    return this.#specificationVersion;
  }
  set specificationVersion(value: number | undefined) {
    this.#specificationVersion = value;
  }

  /**
   * The pinned specification's catalogue number — **a reference, not the
   * address**.
   *
   * A storefront path is built from `offeringId`, never from this. One
   * `ProductSpecification` may be offered by several vendors, so `/p/<code>`
   * collides — and a lookup by code returns the *first* match rather than
   * failing, which makes the second vendor's listing silently unreachable
   * instead of visibly broken. What this member is for is the reference a buyer
   * quotes back, which is why the storefront already labels it "Referencia".
   *
   * `sortable` and `filterable` are stated rather than inherited. They would
   * both default to `true` here (a scalar's default; only `id` and links default
   * to `false`), but every member of this class declares its own — and the flags
   * are simultaneously the server-side RSQL allowlist, so the value of writing
   * them down is that removing one has to be deliberate.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:published-offering.fields.code',
    sortable: true,
    filterable: true,
  })
  get code(): string | undefined {
    return this.#code;
  }
  set code(value: string | undefined) {
    this.#code = value;
  }

  /**
   * The specification's description, as the storefront card's body text.
   *
   * Not `filterable`: an unanchored `like` over prose is a collection scan no
   * index serves, and nothing asks for one — the storefront's search matches
   * `name`.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:published-offering.fields.description',
    sortable: false,
    filterable: false,
  })
  get description(): string | undefined {
    return this.#description;
  }
  set description(value: string | undefined) {
    this.#description = value;
  }

  /**
   * The brand and category the specification is classified under, as **plain
   * ids into `catalog-reference`** — a platform-plane store this slice also
   * owns, so the storefront resolves the names through that domain's own read
   * path rather than reading a name frozen at publication.
   *
   * `filterable` because `/c/<category>` is a filter on `categoryId`, and that
   * flag is the allowlist the query is checked against.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:published-offering.fields.brandId',
    filterable: true,
  })
  get brandId(): string | undefined {
    return this.#brandId;
  }
  set brandId(value: string | undefined) {
    this.#brandId = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:published-offering.fields.categoryId',
    filterable: true,
  })
  get categoryId(): string | undefined {
    return this.#categoryId;
  }
  set categoryId(value: string | undefined) {
    this.#categoryId = value;
  }

  /**
   * The pictures, copied off the pinned specification at publication, in the
   * vendor's order: the first is the card image, the rest the gallery
   * ([ADR 0061](../../../../../../docs/adr/0061-the-snapshot-carries-media-and-the-vendor-is-a-projection.md)).
   *
   * Every URL here is an absolute `https:` one. The save refused anything else
   * and the projector reads the payload through `readMedia`, which drops what
   * the save would have refused, so a reader renders it into an `src` as is.
   * Absent, never `[]`, when there are none.
   */
  @accessor({
    type: 'composition',
    childType: () => MediaReference,
    labelKey: 'entity:published-offering.fields.media',
  })
  get media(): readonly MediaReferenceValue[] | undefined {
    return this.#media;
  }
  set media(value: readonly MediaReferenceValue[] | undefined) {
    this.#media = value;
  }

  /**
   * The phones this offering fits, as ids into `catalog-reference`'s
   * `DeviceModel`, or `universal` alone (plan 1.17).
   *
   * `filterable` — the storefront's "my phone" is
   * `fitsDeviceModelIds=in=(<model>,universal)`, and the flag is the allowlist
   * that query is checked against. Legal on a `scalarCollection` since entifix
   * 0.23.0: an equality or `in` matches when **any** element does, which on
   * Mongo is the array semantics `$in` already has. Never sortable.
   */
  @accessor({
    type: 'scalarCollection',
    labelKey: 'entity:published-offering.fields.fitsDeviceModelIds',
    filterable: true,
  })
  get fitsDeviceModelIds(): readonly string[] | undefined {
    return this.#fitsDeviceModelIds;
  }
  set fitsDeviceModelIds(value: readonly string[] | undefined) {
    this.#fitsDeviceModelIds = value;
  }
  // #endregion
}
