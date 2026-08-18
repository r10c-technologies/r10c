import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

import {
  type ChannelCommissionRates,
  commissionForChannel,
} from '../../values/channel-commission';

/**
 * The contract between the platform and a vendor: what the platform takes, and
 * from when.
 *
 * This is where commission lives, and it is deliberately **not** a field on
 * `Organization`. An organization record is what makes a tenant exist; a
 * commercial term is a negotiated thing that changes on its own clock and has to
 * be readable as of a date. Putting the rate on the organization would make
 * every historical settlement unauditable the moment the rate changed.
 *
 * `commissionBasisPoints` is an integer — 250 is 2.5% — for the same reason
 * prices are minor units: a percentage held as a float compounds a rounding
 * error across every line of every payout.
 *
 * **The rate is per channel**, with a default. Once a vendor can sell in their
 * own shop, one rate stops being expressible: a platform that takes 8% on a sale
 * it sourced through the storefront has a much weaker claim on a sale the vendor
 * made to their own walk-in customer, and "0% on your own counter" is a term
 * people actually negotiate. Putting it here rather than in code makes it a
 * contract term that varies per vendor and is auditable as of a date, which is
 * the same argument that kept commission off `Organization`
 * ([ADR 0024](../../../../../../docs/adr/0024-selling-through-a-vendors-own-channel.md)).
 *
 * **Control plane**, unlike its neighbours in commerce. The rule is who may read
 * it, and this is the platform's own record about a vendor — the same character
 * as `Entitlement`, and nothing like a public catalog. A slice owning stores in
 * more than one plane is explicitly allowed
 * ([ADR 0020](../../../../../../docs/adr/0020-stores-and-slices.md)).
 *
 * ODA analogue: Agreement Management (TMFC039).
 */
@entity({
  domain: 'settlement-management',
  key: 'agreement',
  labelKey: 'entity:agreement.label',
  pluralKey: 'entity:agreement.plural',
})
export class Agreement implements Entity {
  // #region properties
  #id?: EntityId;
  #vendorId: string;
  #commissionBasisPoints: number;
  #channelCommissionBasisPoints?: ChannelCommissionRates;
  #effectiveFrom?: Date;
  // #endregion

  // #region constructors
  constructor(vendorId = '', commissionBasisPoints = 0) {
    this.#vendorId = vendorId;
    this.#commissionBasisPoints = commissionBasisPoints;
  }
  // #endregion

  // #region methods
  /**
   * What the platform takes on a line that came through `channelType`, in basis
   * points. An explicit channel rate wins; everything else falls back to
   * {@link commissionBasisPoints}.
   */
  commissionFor(channelType: string | undefined): number {
    return commissionForChannel(
      this.#channelCommissionBasisPoints,
      this.#commissionBasisPoints,
      channelType,
    );
  }
  // #endregion

  // #region accessors
  @accessor({ labelKey: 'entity:agreement.fields.id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  /** The vendor `Organization` this agreement binds. */
  @accessor({
    type: 'string',
    labelKey: 'entity:agreement.fields.vendorId',
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
   * Hundredths of a percent. `250` is 2.5%.
   *
   * The **default** rate: what applies to a line whose channel has no explicit
   * term, and to every line placed before channels existed.
   */
  @accessor({
    type: 'number',
    labelKey: 'entity:agreement.fields.commissionBasisPoints',
    required: true,
    sortable: true,
    filterable: true,
  })
  get commissionBasisPoints(): number {
    return this.#commissionBasisPoints;
  }
  set commissionBasisPoints(value: number) {
    this.#commissionBasisPoints = value;
  }

  /**
   * Per-channel overrides, keyed by channel type. Absent entries take the
   * default above; `{ counter: 0 }` is the term this member exists for.
   *
   * Not filterable or sortable — it is an embedded object, and member metadata
   * is the server-side RSQL allowlist, so declaring it queryable would advertise
   * a comparison that matches nothing. Settling reads the whole agreement
   * anyway; it never selects one by its rate table.
   *
   * Resolve it through {@link commissionFor}, never by indexing this directly —
   * a rate of `0` is meaningful and a truthiness check would charge full
   * commission for a free channel.
   */
  @accessor({
    type: 'number',
    labelKey: 'entity:agreement.fields.channelCommissionBasisPoints',
    sortable: false,
    filterable: false,
  })
  get channelCommissionBasisPoints(): ChannelCommissionRates | undefined {
    return this.#channelCommissionBasisPoints;
  }
  set channelCommissionBasisPoints(value: ChannelCommissionRates | undefined) {
    this.#channelCommissionBasisPoints = value;
  }

  /**
   * When this agreement starts applying. Filterable and sortable because
   * settling a period means finding the agreement in force during it, not the
   * latest one.
   */
  @accessor({
    type: 'date',
    labelKey: 'entity:agreement.fields.effectiveFrom',
    sortable: true,
    filterable: true,
  })
  get effectiveFrom(): Date | undefined {
    return this.#effectiveFrom;
  }
  set effectiveFrom(value: Date | undefined) {
    this.#effectiveFrom = value;
  }
  // #endregion
}
