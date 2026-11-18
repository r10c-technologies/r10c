import { accessor } from '@entifix/core';
import type { BuyerContactValue } from '@r10c/business-ts-order-contracts';

/**
 * The buyer's contact as the checkout group holds it — one row of the group's
 * `contact` composition, flat, so a detail grid can show it
 * ([ADR 0076](../../../../../../docs/adr/0076-delivery-destination-buyer-contact-and-the-way-back.md) §1).
 *
 * A value, not an entity. A group holds **at most one**: none for a counter
 * sale, whose walk-in leaves with the goods, and none once the retention sweep
 * has removed it. It is checked by `decodeBuyerContact` before it is written,
 * and never put on the bus.
 */
export class CheckoutContact {
  #name = '';
  #phone = '';
  #email = '';
  #departamento = '';
  #municipio = '';
  #zona?: number;
  #addressLine = '';
  #reference?: string;

  @accessor({
    type: 'string',
    labelKey: 'entity:checkout-group.fields.buyer.name',
  })
  get name(): string {
    return this.#name;
  }
  set name(value: string) {
    this.#name = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:checkout-group.fields.buyer.phone',
  })
  get phone(): string {
    return this.#phone;
  }
  set phone(value: string) {
    this.#phone = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:checkout-group.fields.buyer.email',
  })
  get email(): string {
    return this.#email;
  }
  set email(value: string) {
    this.#email = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:checkout-group.fields.buyer.departamento',
  })
  get departamento(): string {
    return this.#departamento;
  }
  set departamento(value: string) {
    this.#departamento = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:checkout-group.fields.buyer.municipio',
  })
  get municipio(): string {
    return this.#municipio;
  }
  set municipio(value: string) {
    this.#municipio = value;
  }

  @accessor({
    type: 'number',
    labelKey: 'entity:checkout-group.fields.buyer.zona',
  })
  get zona(): number | undefined {
    return this.#zona;
  }
  set zona(value: number | undefined) {
    this.#zona = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:checkout-group.fields.buyer.addressLine',
  })
  get addressLine(): string {
    return this.#addressLine;
  }
  set addressLine(value: string) {
    this.#addressLine = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:checkout-group.fields.buyer.reference',
  })
  get reference(): string | undefined {
    return this.#reference;
  }
  set reference(value: string | undefined) {
    this.#reference = value;
  }
}

/** The row a checked contact is stored as. */
export const checkoutContactOf = (value: BuyerContactValue): CheckoutContact =>
  Object.assign(new CheckoutContact(), {
    name: value.name,
    phone: value.phone,
    email: value.email,
    departamento: value.destination.departamento,
    municipio: value.destination.municipio,
    zona: value.destination.zona,
    addressLine: value.destination.addressLine,
    reference: value.destination.reference,
  });
