import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

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
  #effectiveFrom?: Date;
  // #endregion

  // #region constructors
  constructor(vendorId = '', commissionBasisPoints = 0) {
    this.#vendorId = vendorId;
    this.#commissionBasisPoints = commissionBasisPoints;
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

  /** Hundredths of a percent. `250` is 2.5%. */
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
