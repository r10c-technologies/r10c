import type { Entity, EntityId } from '@entifix/core';
import { accessor, entity } from '@entifix/core';
import {
  MediaReference,
  type MediaReferenceValue,
  VariantValueEntry,
} from '@r10c/business-ts-catalog-contracts';
import {
  DEFAULT_SALE_UNIT,
  type KitComponent,
  KitComponentRow,
  oneWholeUnit,
  SALE_UNIT_NAME_KEY,
  SALE_UNIT_SCALES,
  SALE_UNIT_SYMBOL_KEY,
  type SaleUnit,
  SaleUnits,
  type VariantValue,
} from '@r10c/business-ts-sales-vocabulary';

import {
  DeletableOfferingStatuses,
  type OfferingStatus,
  OfferingStatuses,
  OfferingStatusTones,
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
 * and checkout prices against them, so only *characteristics* are meant to be
 * specification-driven. Today `specificationId` names a `ProductSpecification`
 * with no version: the offering pins nothing, and an edit to the specification
 * reaches every offering that names it. The design — an immutable, versioned
 * specification an offering is authored under, so February's records stay
 * readable after March's redefinition — is
 * [ADR 0014](../../../../../../../docs/adr/0014-entity-specifications-and-the-characteristic-dictionary.md)
 * and, for versioning, [ADR 0079](../../../../../../../docs/adr/0079-a-published-specification-is-versioned-and-a-save-names-the-revision-it-read.md)
 * (both Proposed).
 *
 * Price is deliberately elsewhere: see `ProductOfferingPrice`.
 *
 * Tenant plane, `catalog` store.
 */
@entity({
  labelMember: 'name',
  domain: 'product-configuration-management',
  key: 'product-offering',
  labelKey: 'entity:product-offering.label',
  pluralKey: 'entity:product-offering.plural',
  // Edited in any status — a published offering is edited and published
  // again (ADR 0047) — but deleted only off sale: unpublish first.
  deletableWhen: { member: 'status', in: [...DeletableOfferingStatuses] },
})
export class ProductOffering implements Entity {
  // #region properties
  #id?: EntityId;
  #name: string;
  #sku?: string;
  #specificationId: string;
  #status: OfferingStatus = 'draft';
  #statusChangedAt?: Date;
  #saleUnit: SaleUnit = DEFAULT_SALE_UNIT;
  #quantityStep = oneWholeUnit(DEFAULT_SALE_UNIT);
  #quantityMinimum = oneWholeUnit(DEFAULT_SALE_UNIT);
  #stockOfferingId?: string;
  #stockFactor?: number;
  #variantValues?: readonly VariantValue[];
  #kitComponents?: readonly KitComponent[];
  #kitSize?: number;
  #media?: readonly MediaReferenceValue[];
  #revision?: number;
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
   * The vendor's own code for this offering — what its labels print, its
   * scanner types and its sheets are keyed by. Optional, and **unique within
   * the organization**: each organization has its own catalog store, and the
   * store refuses a second offering with the same code (`duplicateKey`), so
   * no read-then-write race can let two through. Trimmed on every save, blank
   * is no SKU, and anything a label would not print is `skuInvalid`.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:product-offering.fields.sku',
    unique: true,
    sortable: true,
    filterable: true,
  })
  get sku(): string | undefined {
    return this.#sku;
  }
  set sku(value: string | undefined) {
    this.#sku = value;
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
    references: {
      entity: 'product-configuration-management:product-specification',
    },
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
    enumTones: OfferingStatusTones,
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

  /**
   * What one of this offering is: a piece, a pair, a metre… (ADR 0082 §1).
   * Every quantity of it — step, minimum, cart, hold, order line — is an
   * integer in this unit's scale, so it never travels without it.
   *
   * ⚠️ **Server-owned.** An offering starts in `UN`; only `set-sale-unit`
   * changes it, and only until the first publication. A save carries the
   * stored unit across, as it does `status`, because a unit that changed under
   * stored quantities would change what each of them means.
   */
  @accessor({
    type: 'enum',
    labelKey: 'entity:product-offering.fields.saleUnit',
    enumValues: SaleUnits,
    enumLabelKey: SALE_UNIT_NAME_KEY,
    filterable: true,
  })
  get saleUnit(): SaleUnit {
    return this.#saleUnit;
  }
  set saleUnit(value: SaleUnit) {
    this.#saleUnit = value;
  }

  /**
   * The quantities this offering sells come in steps of this much, in the
   * unit's scale: `500` in `M` sells by the half metre. Effective at the next
   * publication; a quantity between steps is refused, never rounded (§3).
   */
  @accessor({
    type: 'number',
    labelKey: 'entity:product-offering.fields.quantityStep',
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

  /** The least one line may ask, in the unit's scale; a multiple of the step. */
  @accessor({
    type: 'number',
    labelKey: 'entity:product-offering.fields.quantityMinimum',
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
   * The base offering this one draws its stock from, when it is a
   * presentation — a box, a roll, a dozen (ADR 0082 §7). It is sold in `UN`
   * and has no stock of its own: each one sold takes `stockFactor` from the
   * base's, so a box and loose units compete for one balance.
   *
   * ⚠️ **Server-owned.** Only `draw-on-stock` sets it; a save carries the
   * stored value across. One level: a base draws on nothing, and a presentation
   * is nobody's base. A plain id in the same tenant catalog, so one vendor.
   */
  @accessor({
    references: { entity: 'product-configuration-management:product-offering' },
    type: 'string',
    labelKey: 'entity:product-offering.fields.stockOfferingId',
    filterable: true,
  })
  get stockOfferingId(): string | undefined {
    return this.#stockOfferingId;
  }
  set stockOfferingId(value: string | undefined) {
    this.#stockOfferingId = value;
  }

  /**
   * How many of the base's scaled quantities one of this takes: a 100 m roll
   * of a cable stocked in metres is `100000`. Server-owned with
   * `stockOfferingId`; effective at the next publication.
   */
  @accessor({
    type: 'number',
    labelKey: 'entity:product-offering.fields.stockFactor',
    sortable: false,
    filterable: false,
  })
  get stockFactor(): number | undefined {
    return this.#stockFactor;
  }
  set stockFactor(value: number | undefined) {
    this.#stockFactor = value;
  }

  /**
   * What makes this offering one **variant** of its product: the colour, the
   * size, the finish or the capacity it is sold in, beside the product's
   * other offerings in the same specification series
   * ([ADR 0085](../../../../../../../docs/adr/0085-variants-are-offerings.md)).
   * Each variant is a whole offering — its own price, stock row and order
   * line — so nothing downstream of the catalog learns the word.
   *
   * ⚠️ **Server-owned.** Only `set-variant` writes it, checking the axes
   * against the product's other variants; a save carries the stored value
   * across. Absent is no variant, never `[]`.
   */
  @accessor({
    type: 'composition',
    childType: () => VariantValueEntry,
    labelKey: 'entity:product-offering.fields.variantValues',
  })
  get variantValues(): readonly VariantValue[] | undefined {
    return this.#variantValues;
  }
  set variantValues(value: readonly VariantValue[] | undefined) {
    this.#variantValues = value;
  }

  /**
   * What makes this offering a **kit**: other offerings of the same vendor,
   * and how many of each one kit holds — a case and its screen protector at
   * one price
   * ([ADR 0086](../../../../../../../docs/adr/0086-a-kit-sells-several-offerings-at-one-price.md)).
   * A kit is sold in `UN` and holds no stock of its own: each one sold takes
   * its components from theirs, so a kit and a loose component compete for one
   * balance.
   *
   * ⚠️ **Server-owned.** Only `set-kit` writes it; a save carries the stored
   * value across. Absent is no kit, never `[]`.
   */
  @accessor({
    type: 'composition',
    childType: () => KitComponentRow,
    labelKey: 'entity:product-offering.fields.kitComponents',
  })
  get kitComponents(): readonly KitComponent[] | undefined {
    return this.#kitComponents;
  }
  set kitComponents(value: readonly KitComponent[] | undefined) {
    this.#kitComponents = value;
  }

  /**
   * How many components the kit holds, written with them: the one fact about
   * a kit a query can ask, since a composition is never filtered. Absent on an
   * offering that is not a kit. Server-owned with `kitComponents`.
   */
  @accessor({
    type: 'number',
    labelKey: 'entity:product-offering.fields.kitSize',
    filterable: true,
  })
  get kitSize(): number | undefined {
    return this.#kitSize;
  }
  set kitSize(value: number | undefined) {
    this.#kitSize = value;
  }

  /**
   * This offering's own pictures — a black case is not the blue one's photo.
   * Absent, the publication shows its specification's (ADR 0061, ADR 0085).
   * The same references the specification holds, checked by `mediaRefusal`
   * on every write path.
   */
  @accessor({
    type: 'composition',
    childType: () => MediaReference,
    labelKey: 'entity:product-offering.fields.media',
  })
  get media(): readonly MediaReferenceValue[] | undefined {
    return this.#media;
  }
  set media(value: readonly MediaReferenceValue[] | undefined) {
    this.#media = value;
  }

  // The revision check (ADR 0079 §4, entifix 0032): an authored record states
  // the revision it read and a save is conditional on it. Server-owned but
  // client-visible, so neither `readonly` nor `hidden`; it presents as nothing.
  @accessor({ type: 'revision', label: 'Revision' })
  get revision(): number | undefined {
    return this.#revision;
  }
  set revision(value: number | undefined) {
    this.#revision = value;
  }
  // #endregion
}
