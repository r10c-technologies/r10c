import { accessor } from '@entifix/core';

/**
 * What a checkout group charges in one currency, in minor units — the child of
 * {@link CheckoutGroup}'s `totals` composition, described by its accessors
 * alone ([ADR 0034](../../../../../docs/adr/0034-composition-metadata.md)).
 */
export class GroupTotal {
  // #region properties
  #amount: number;
  #currency: string;
  // #endregion

  // #region constructors
  constructor(amount = 0, currency = '') {
    this.#amount = amount;
    this.#currency = currency;
  }
  // #endregion

  // #region accessors
  @accessor({
    type: 'number',
    labelKey: 'entity:checkout-group.fields.total.amount',
    required: true,
  })
  get amount(): number {
    return this.#amount;
  }
  set amount(value: number) {
    this.#amount = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:checkout-group.fields.total.currency',
    required: true,
  })
  get currency(): string {
    return this.#currency;
  }
  set currency(value: string) {
    this.#currency = value;
  }
  // #endregion
}
