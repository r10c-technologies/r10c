import { Entity, EntityId } from '@entifix/core';
import { accessor, entity } from '@entifix/core';
import {
  MediaReference,
  type MediaReferenceValue,
} from '@r10c/business-ts-catalog-contracts';

import {
  type SpecificationLifecycleStatus,
  SpecificationLifecycleStatuses,
  SpecificationLifecycleTones,
} from '../../values/specification-lifecycle';

/**
 * What a thing **is** — the facts common to every instance of it. Definitional,
 * not commercial.
 *
 * This class was called `Product` until
 * [ADR 0022](../../../../../../docs/adr/0022-v1-marketplace-module-boundaries.md).
 * It was the wrong name, and expensively so: in SID a `Product` is an **instance
 * a party owns** after an order completes — what a subscription later becomes —
 * while a catalog record is a `ProductSpecification`. Holding the name here left
 * the owned instance with nowhere to live, and every month made the rename
 * larger, since the entity key is simultaneously the permission namespace, the
 * i18n catalog key, the route path and the Mongo collection name.
 *
 * The commercial half is deliberately elsewhere: `ProductOffering` is what is
 * orderable and priced, so one specification can be sold several ways without
 * being redefined.
 *
 * ⚠️ **One record is one version** (ADR 0079 §1). The series shares a
 * `specKey`; each version carries its own `version` and `lifecycleStatus`, and
 * only `in-design` has an edit path — `release` freezes it, `revise` opens the
 * next version beside it. An offering pins **this record's id**, so a pin
 * names one frozen version, never "whatever the specification says today".
 *
 * Tenant plane, `catalog` store.
 */
@entity({
  labelMember: 'name',
  domain: 'product-configuration-management',
  key: 'product-specification',
  labelKey: 'entity:product-specification.label',
  pluralKey: 'entity:product-specification.plural',
})
export class ProductSpecification implements Entity {
  // #region properties
  #id?: EntityId;
  #code: string;
  #name: string;
  #description?: string;
  #brandId?: string;
  #categoryId?: string;
  #media?: readonly MediaReferenceValue[];
  #fitsDeviceModelIds?: readonly string[];
  #specKey?: string;
  #version?: number;
  #lifecycleStatus?: SpecificationLifecycleStatus;
  #validFrom?: Date;
  #validTo?: Date;
  #contentHash?: string;
  #revision?: number;
  // #endregion

  // #region constructors
  constructor(code = '', name = '') {
    this.#code = code;
    this.#name = name;
  }
  // #endregion

  // #region methods
  // #endregion

  // #region accessors
  @accessor({
    type: 'id',
    label: 'ID',
    labelKey: 'entity:product-specification.fields.id',
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
   * The catalogue number, and it is **the service's to assign, not the
   * client's**.
   *
   * The create command draws it from the organization's `counters` document in
   * the same unit of work as the record and writes `entity.code`
   * unconditionally, so whatever a form sends is overwritten. Every version of
   * one series shares it: `revise` copies it with `specKey`. It is therefore **not `required`**, because requiring it
   * demands of the operator something they do not own; the service's own
   * `validate` asks for `name` and never for this.
   *
   * Not `@accessor({ readonly })` either, for the reason `CLAUDE.md` records:
   * that flag drops the member from deserialization too, so the assigned code
   * would never reach the screen that lists it. Left writable and hidden from
   * the form with `hiddenFields`, exactly as `ProductBrand.code` already is.
   *
   * `resetOnClone` still earns its place: a copy must not carry the original's
   * identifier through the draft, or the summary of a duplicated record shows a
   * number belonging to something else.
   */
  @accessor({
    type: 'string',
    label: 'Code',
    labelKey: 'entity:product-specification.fields.code',
    resetOnClone: true,
  })
  get code(): string {
    return this.#code;
  }
  set code(value: string) {
    this.#code = value;
  }

  // `filterable` is declared rather than inherited from the scalar default, for
  // the reason `ProductBrand.name` spells out at length: the flag is
  // simultaneously the server-side RSQL allowlist, and this is the member the
  // back office's record search matches a term against. Losing it is silent at
  // both ends — the service answers `400`, and the palette renders that as a
  // group that could not be reached, which reads as "there are no products".
  @accessor({
    type: 'string',
    label: 'Name',
    labelKey: 'entity:product-specification.fields.name',
    required: true,
    filterable: true,
  })
  get name(): string {
    return this.#name;
  }
  set name(value: string) {
    this.#name = value;
  }

  @accessor({
    type: 'string',
    label: 'Description',
    labelKey: 'entity:product-specification.fields.description',
  })
  get description(): string | undefined {
    return this.#description;
  }
  set description(value: string | undefined) {
    this.#description = value;
  }

  /**
   * The brand and category this specification is classified under, as **plain
   * ids**.
   *
   * They were typed `EntityLink<ProductBrand>` / `EntityLink<ProductCategory>`,
   * resolved at the storage layer against the same tenant database. Both targets
   * now live in `catalog-reference` — platform plane, a different store with a
   * different writing slice — and the `business:domain` tag may not depend on
   * another `business:domain`, so the typed link is no longer a legal edge
   * ([ADR 0022](../../../../../../docs/adr/0022-v1-marketplace-module-boundaries.md)).
   *
   * That prohibition is the rule working, not an obstacle. A storage-layer join
   * across a store boundary is exactly the coupling that would make this domain
   * unsplittable later; a cross-domain reference resolves through the owning
   * domain's use-case port instead, and the id is what that port takes.
   *
   * Filterable because "every specification in this category" is the vendor's
   * own list screen.
   */
  @accessor({
    references: { entity: 'catalog-reference:product-brand' },
    type: 'string',
    labelKey: 'entity:product-specification.fields.brand',
    filterable: true,
  })
  get brandId(): string | undefined {
    return this.#brandId;
  }
  set brandId(value: string | undefined) {
    this.#brandId = value;
  }

  @accessor({
    references: { entity: 'catalog-reference:product-category' },
    type: 'string',
    labelKey: 'entity:product-specification.fields.category',
    filterable: true,
  })
  get categoryId(): string | undefined {
    return this.#categoryId;
  }
  set categoryId(value: string | undefined) {
    this.#categoryId = value;
  }

  /**
   * The pictures of this thing, in the vendor's order — the first is the card
   * image. **References the vendor authored, never bytes we store**: a URL and
   * its alt text, nothing uploaded
   * ([ADR 0061](../../../../../../docs/adr/0061-the-snapshot-carries-media-and-the-vendor-is-a-projection.md)).
   *
   * A `composition`, because an entry has no life outside this record and is
   * never picked from existing ones — so the generic form edits it as a detail
   * grid (ADR 0038). `https` and the alt text are checked by `mediaRefusal` on
   * both write paths, the `POST` command and the `PUT`; the entity cannot say
   * "absolute https URL", and `required` on the child only says "not empty".
   */
  @accessor({
    type: 'composition',
    childType: () => MediaReference,
    labelKey: 'entity:product-specification.fields.media',
  })
  get media(): readonly MediaReferenceValue[] | undefined {
    return this.#media;
  }
  set media(value: readonly MediaReferenceValue[] | undefined) {
    this.#media = value;
  }

  /**
   * The phones this thing fits, as **plain ids into `catalog-reference`'s
   * `DeviceModel`** — or the one reserved id `universal`, alone, for a charger
   * or a cable that fits every phone (plan 1.17, r10c #641). Empty or absent
   * means the vendor has not said.
   *
   * A `scalarCollection` of ids for the reason `brandId` is a plain id: the
   * target is another slice's store. It cannot declare `references` — entifix
   * holds a reference to one record's id — so the back office's picker is a
   * control of r10c's own, and `universal` beside another id is refused on both
   * write paths by `refuseSpecificationFits`.
   *
   * Not queryable here: the vendor's list never filters by it. The storefront
   * does, on the published snapshot, where the same member is `filterable`.
   */
  @accessor({
    type: 'scalarCollection',
    labelKey: 'entity:product-specification.fields.fitsDeviceModelIds',
  })
  get fitsDeviceModelIds(): readonly string[] | undefined {
    return this.#fitsDeviceModelIds;
  }
  set fitsDeviceModelIds(value: readonly string[] | undefined) {
    this.#fitsDeviceModelIds = value;
  }

  /**
   * The series this version belongs to — stable across every version, the key
   * `version` is monotonic under (ADR 0079 §1). Assigned at create from the
   * same counter draw as `code`, and copied by `revise`.
   *
   * ⚠️ Every lifecycle member below is **server-owned and client-visible**, so
   * none is `readonly` (that drops it from serialization both ways) and none is
   * `required` (a hidden required member still validates).
   * `preserveSpecificationLifecycle` restores them on every save, and the form
   * hides them as inputs.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:product-specification.fields.specKey',
    filterable: true,
  })
  get specKey(): string | undefined {
    return this.#specKey;
  }
  set specKey(value: string | undefined) {
    this.#specKey = value;
  }

  /** Monotonic per `specKey`, `1` for the first. An order line copies it. */
  @accessor({
    type: 'number',
    labelKey: 'entity:product-specification.fields.version',
    sortable: true,
    filterable: true,
  })
  get version(): number | undefined {
    return this.#version;
  }
  set version(value: number | undefined) {
    this.#version = value;
  }

  /**
   * Where this version stands. Moved only by the four verbs, each a write
   * conditional on the state it leaves — hiding a verb is presentation, the
   * conditional write is the rule (ADR 0079 §1).
   */
  @accessor({
    type: 'enum',
    labelKey: 'entity:product-specification.fields.lifecycleStatus',
    enumValues: SpecificationLifecycleStatuses,
    enumTones: SpecificationLifecycleTones,
    enumLabelKey: 'entity:product-specification.values.lifecycleStatus',
    filterable: true,
  })
  get lifecycleStatus(): SpecificationLifecycleStatus | undefined {
    return this.#lifecycleStatus;
  }
  set lifecycleStatus(value: SpecificationLifecycleStatus | undefined) {
    this.#lifecycleStatus = value;
  }

  /** When this version was released: the start of SID's `validFor`. */
  @accessor({
    type: 'date',
    labelKey: 'entity:product-specification.fields.validFrom',
    sortable: true,
  })
  get validFrom(): Date | undefined {
    return this.#validFrom;
  }
  set validFrom(value: Date | undefined) {
    this.#validFrom = value;
  }

  /** When it stopped being the active version: the end of `validFor`. */
  @accessor({
    type: 'date',
    labelKey: 'entity:product-specification.fields.validTo',
  })
  get validTo(): Date | undefined {
    return this.#validTo;
  }
  set validTo(value: Date | undefined) {
    this.#validTo = value;
  }

  /**
   * The SHA-256 of what this version says, stamped at release
   * (`contentHashOf`). A frozen version whose content no longer hashes to it
   * was changed by a path that is not supposed to exist.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:product-specification.fields.contentHash',
  })
  get contentHash(): string | undefined {
    return this.#contentHash;
  }
  set contentHash(value: string | undefined) {
    this.#contentHash = value;
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
