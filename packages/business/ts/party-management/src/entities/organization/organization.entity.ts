import type { Entity, EntityId } from '@entifix/core';
import { accessor, entity } from '@entifix/core';
import { type TaxRegime, TaxRegimes } from '@r10c/business-ts-tax-policy';

/**
 * Lifecycle state of an organization. A non-`active` organization keeps its
 * storage — suspension is a billing or compliance state, never a deletion.
 */
export const OrganizationStatus = {
  Active: 'active',
  Suspended: 'suspended',
  Archived: 'archived',
} as const;

export type OrganizationStatus =
  (typeof OrganizationStatus)[keyof typeof OrganizationStatus];

/**
 * A `Party` that is a company — and **the tenant**: the unit that per-tenant
 * storage is provisioned for.
 *
 * This entity is the one place tenancy is explicit. Every other business entity
 * is organization-agnostic (no `organizationId` member, no tenant filter);
 * isolation comes from which database handle a request resolves to, which is
 * why no query can leak by omission. The organization record is what makes that
 * handle derivable, so it necessarily lives in the **control plane**.
 *
 * `slug` is stable and human-readable — it appears in operator tooling and in
 * support conversations — but it is deliberately *not* what names the tenant
 * database. That is derived from the id, so renaming an organization can never
 * strand its data.
 */
@entity({
  domain: 'party-management',
  key: 'organization',
  labelKey: 'entity:organization.label',
  pluralKey: 'entity:organization.plural',
})
export class Organization implements Entity {
  // #region properties
  #id?: EntityId;
  #name: string;
  #slug: string;
  #status: OrganizationStatus = OrganizationStatus.Active;
  #taxId = '';
  #legalName = '';
  #taxRegime: TaxRegime = 'general';
  #establishmentCode = '';
  #acceptsPaymentLink = false;
  #whatsappNumber = '';
  #sampleStore = false;
  #updatedAt?: Date;
  // #endregion

  // #region constructors
  constructor(name = '', slug = '') {
    this.#name = name;
    this.#slug = slug;
  }
  // #endregion

  // #region accessors
  @accessor({ labelKey: 'entity:organization.fields.id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:organization.fields.name',
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

  @accessor({
    type: 'string',
    labelKey: 'entity:organization.fields.slug',
    required: true,
    sortable: true,
    filterable: true,
  })
  get slug(): string {
    return this.#slug;
  }
  set slug(value: string) {
    this.#slug = value;
  }

  @accessor({
    type: 'enum',
    labelKey: 'entity:organization.fields.status',
    enumValues: Object.values(OrganizationStatus),
    enumLabelKey: 'entity:organization.values.status',
    sortable: true,
    filterable: true,
  })
  get status(): OrganizationStatus {
    return this.#status;
  }
  set status(value: OrganizationStatus) {
    this.#status = value;
  }

  /**
   * The seller's fiscal identity — what a document issued in its name carries,
   * copied onto every order at placement (ADR 0078 §6). Written by the
   * organization's own `admin` through `set-fiscal-identity`, never by the
   * generic save: the name, slug and status beside them are the operator's.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:organization.fields.taxId',
    required: true,
    filterable: false,
  })
  get taxId(): string {
    return this.#taxId;
  }
  set taxId(value: string) {
    this.#taxId = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:organization.fields.legalName',
    required: true,
    filterable: false,
  })
  get legalName(): string {
    return this.#legalName;
  }
  set legalName(value: string) {
    this.#legalName = value;
  }

  @accessor({
    type: 'enum',
    labelKey: 'entity:organization.fields.taxRegime',
    enumValues: [...TaxRegimes],
    enumLabelKey: 'entity:organization.values.taxRegime',
    required: true,
    filterable: false,
  })
  get taxRegime(): TaxRegime {
    return this.#taxRegime;
  }
  set taxRegime(value: TaxRegime) {
    this.#taxRegime = value;
  }

  /** The SAT establishment the organization sells from, as a number. */
  @accessor({
    type: 'string',
    labelKey: 'entity:organization.fields.establishmentCode',
    required: true,
    filterable: false,
  })
  get establishmentCode(): string {
    return this.#establishmentCode;
  }
  set establishmentCode(value: string) {
    this.#establishmentCode = value;
  }

  /**
   * Whether the organization takes payment by a link it sends the buyer
   * (ADR 0081 §1). Authored by the organization's own `admin` through
   * `set-payment-link-acceptance`, never provisioned, and announced as the
   * published vendor's `acceptsLink`.
   */
  @accessor({
    type: 'boolean',
    labelKey: 'entity:organization.fields.acceptsPaymentLink',
    filterable: false,
  })
  get acceptsPaymentLink(): boolean {
    return this.#acceptsPaymentLink;
  }
  set acceptsPaymentLink(value: boolean) {
    this.#acceptsPaymentLink = value;
  }

  /**
   * The WhatsApp number buyers may write to, as E.164 (`+50255551234`), or
   * `''` for none (#671). Authored by the organization's own `admin` through
   * `set-whatsapp-number`, and announced to the published vendor: a receipt
   * links to it.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:organization.fields.whatsappNumber',
    filterable: false,
  })
  get whatsappNumber(): string {
    return this.#whatsappNumber;
  }
  set whatsappNumber(value: string) {
    this.#whatsappNumber = value;
  }

  /**
   * Whether this is one of the lab's sample stores, whose prices are
   * illustrative (#676). Written by the seed when the organization is first
   * created and never by a verb: no organization a person creates is a sample.
   * Announced to the published vendor, so the storefront says so wherever it
   * shows the store or its products.
   *
   * ⚠️ **Server-owned, and writable anyway**, for the reason `CLAUDE.md`
   * records: `readonly` would drop it from serialization both ways, and so
   * would `hidden`. No verb writes it, so no form offers it.
   */
  @accessor({
    type: 'boolean',
    labelKey: 'entity:organization.fields.sampleStore',
    filterable: false,
    sortable: false,
  })
  get sampleStore(): boolean {
    return this.#sampleStore;
  }
  set sampleStore(value: boolean) {
    this.#sampleStore = value;
  }

  /**
   * When this record was last written, and the moment its announcement is
   * stamped with (ADR 0061).
   *
   * ⚠️ **Server-owned, and writable anyway**, for the reason `CLAUDE.md`
   * records: `readonly` would drop it from deserialization too. Every write
   * path sets it, today only auth-service's seed, and the rebuild walk
   * re-announces an organization at this moment rather than at `now`, so a
   * re-statement can never outrank a rename that landed while it ran.
   */
  @accessor({
    type: 'date',
    labelKey: 'entity:organization.fields.updatedAt',
    sortable: true,
    // Declared rather than defaulted: member metadata is the query allowlist,
    // and nothing needs to filter on a write stamp.
    filterable: false,
  })
  get updatedAt(): Date | undefined {
    return this.#updatedAt;
  }
  set updatedAt(value: Date | undefined) {
    this.#updatedAt = value;
  }
  // #endregion
}
