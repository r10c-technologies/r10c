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
  // The epoch, so a record written before this member existed compares as
  // older than every real publication rather than as newer than all of them.
  #publishedAt = new Date(0);
  // The merchandising members, and every one of them is optional because its
  // source is: three are `string | undefined` on `ProductSpecification`, and
  // `code` is blanked by a `PUT` that omits it. They are deliberately not
  // constructor parameters — the projector assigns through setters, and a
  // seven-argument constructor would destroy the readable trio below.
  #code?: string;
  #description?: string;
  #brandId?: string;
  #categoryId?: string;
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
  // #endregion
}
