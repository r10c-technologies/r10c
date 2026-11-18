import { accessor, type FieldProblem, Invalid } from '@entifix/core';
import {
  CONTACT_NAME_REQUIRED,
  type DeliveryDestinationValue,
  destinationProblems,
  normalizeDestination,
  normalizePhone,
  PHONE_NOT_GUATEMALAN,
} from '@r10c/business-ts-order-contracts';
import { Effect } from 'effect';

/**
 * Where a parcel goes and who receives it — the vendor's copy of exactly what
 * a courier needs, and nothing more: **no email**, no buyer id
 * ([ADR 0076](../../../../../../docs/adr/0076-delivery-destination-buyer-contact-and-the-way-back.md) §1).
 *
 * A value, one row of the shipment's `destination` composition. A copy, not a
 * link: the vendor's database must not reach into the platform plane at
 * dispatch time. Removed by the retention sweep once the parcel's journey
 * ends, and never put on the bus.
 */
export class ShipmentDestination {
  #name = '';
  #phone = '';
  #departamento = '';
  #municipio = '';
  #zona?: number;
  #addressLine = '';
  #reference?: string;

  @accessor({
    type: 'string',
    labelKey: 'entity:shipping-order.fields.recipient.name',
  })
  get name(): string {
    return this.#name;
  }
  set name(value: string) {
    this.#name = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:shipping-order.fields.recipient.phone',
  })
  get phone(): string {
    return this.#phone;
  }
  set phone(value: string) {
    this.#phone = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:shipping-order.fields.recipient.departamento',
  })
  get departamento(): string {
    return this.#departamento;
  }
  set departamento(value: string) {
    this.#departamento = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:shipping-order.fields.recipient.municipio',
  })
  get municipio(): string {
    return this.#municipio;
  }
  set municipio(value: string) {
    this.#municipio = value;
  }

  @accessor({
    type: 'number',
    labelKey: 'entity:shipping-order.fields.recipient.zona',
  })
  get zona(): number | undefined {
    return this.#zona;
  }
  set zona(value: number | undefined) {
    this.#zona = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:shipping-order.fields.recipient.addressLine',
  })
  get addressLine(): string {
    return this.#addressLine;
  }
  set addressLine(value: string) {
    this.#addressLine = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:shipping-order.fields.recipient.reference',
  })
  get reference(): string | undefined {
    return this.#reference;
  }
  set reference(value: string | undefined) {
    this.#reference = value;
  }
}

/** What a flow states for a shipment's destination: a recipient, and where. */
export interface ShipmentDestinationInput {
  readonly name: unknown;
  readonly phone: unknown;
  readonly destination: unknown;
}

const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};

/**
 * The row a stated destination is stored as, checked by the rules a buyer's
 * contact was — or `Invalid` naming each field under `/destination`.
 */
export const decodeShipmentDestination = (
  value: unknown,
): Effect.Effect<ShipmentDestination, Invalid> => {
  const record = asRecord(value);
  const name = record['name'];
  const phone = normalizePhone(record['phone']);
  const problems: FieldProblem[] = [
    ...(typeof name === 'string' && name.trim() !== ''
      ? []
      : [
          {
            pointer: '/destination/name',
            code: CONTACT_NAME_REQUIRED,
            detail: 'the recipient is named',
          },
        ]),
    ...(phone === undefined
      ? [
          {
            pointer: '/destination/phone',
            code: PHONE_NOT_GUATEMALAN,
            detail: 'the phone is a Guatemalan number of eight digits',
          },
        ]
      : []),
    ...destinationProblems(record['destination'], '/destination/destination'),
  ];
  if (problems.length > 0)
    return Effect.fail(new Invalid({ errors: problems }));
  const where: DeliveryDestinationValue = normalizeDestination(
    record['destination'],
  );
  return Effect.succeed(
    Object.assign(new ShipmentDestination(), {
      name: String(name).trim(),
      phone,
      departamento: where.departamento,
      municipio: where.municipio,
      zona: where.zona,
      addressLine: where.addressLine,
      reference: where.reference,
    }),
  );
};
