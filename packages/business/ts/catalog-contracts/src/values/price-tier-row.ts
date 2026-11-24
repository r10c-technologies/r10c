import { accessor } from '@entifix/core';
import type { PriceTier } from '@r10c/business-ts-sales-vocabulary';

/**
 * One row of a price's `tiers` composition: from `from` on — a quantity in
 * the offering's scale — `amount` minor units buy the price's own `pricePer`
 * ([ADR 0082](../../../../../../docs/adr/0082-an-offering-is-sold-in-a-unit-with-a-step.md) §8).
 * A **value**, not an entity: it has no id and is never addressed apart from
 * the price that holds it (ADR 0034).
 *
 * Declared here rather than in either domain because both hold it:
 * `ProductOfferingPrice` authors it and `PublishedOffering` projects it.
 *
 * Neither member declares a money or scaled format: the unit lives on the
 * offering and the currency on the price, never on the row, so a row read
 * alone could only print them wrong. The screens that show a tier read both
 * from the record around it.
 */
export class PriceTierRow implements PriceTier {
  #from: number;
  #amount: number;

  constructor(from = 0, amount = 0) {
    this.#from = from;
    this.#amount = amount;
  }

  @accessor({
    type: 'number',
    labelKey: 'entity:price-tier.fields.from',
    required: true,
  })
  get from(): number {
    return this.#from;
  }
  set from(value: number) {
    this.#from = value;
  }

  @accessor({
    type: 'number',
    labelKey: 'entity:price-tier.fields.amount',
    required: true,
  })
  get amount(): number {
    return this.#amount;
  }
  set amount(value: number) {
    this.#amount = value;
  }
}
