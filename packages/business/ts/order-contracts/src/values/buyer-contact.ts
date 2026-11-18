import { Failure, type FieldProblem, Invalid, openStruct } from '@entifix/core';
import { Effect, Schema } from 'effect';

import {
  ADDRESS_LINE_REQUIRED,
  DeliveryDestinationSchema,
  type DeliveryDestinationValue,
  DEPARTAMENTO_UNKNOWN,
  destinationProblems,
  isFilled,
  MUNICIPIO_OUTSIDE_DEPARTAMENTO,
  normalizeDestination,
  problem,
  ZONA_OUT_OF_RANGE,
} from './delivery-destination';

/**
 * Who bought and how to reach them: the one record of a storefront buyer the
 * platform keeps, on the checkout group, and copied — less the email — onto
 * each shipment
 * ([ADR 0076](../../../../../../docs/adr/0076-delivery-destination-buyer-contact-and-the-way-back.md) §1–2).
 * Both channels are required: the phone is the courier's, and the email is the
 * only way the platform can reach a buyer who has no account.
 */
export interface BuyerContactValue {
  readonly name: string;
  /** E.164, `+502` and eight digits. */
  readonly phone: string;
  /** Lower-cased. */
  readonly email: string;
  readonly destination: DeliveryDestinationValue;
}

/** The shape on the wire; {@link contactProblems} checks what it means. */
export const BuyerContactSchema = openStruct({
  name: Schema.String,
  phone: Schema.String,
  email: Schema.String,
  destination: DeliveryDestinationSchema,
});

export const CONTACT_NAME_REQUIRED = 'contactNameRequired';
export const PHONE_NOT_GUATEMALAN = 'phoneNotGuatemalan';
export const EMAIL_NOT_VALID = 'emailNotValid';

/** A contact with no name. */
export class ContactNameRequired extends Failure.invalid<ContactNameRequired>()(
  'ContactNameRequired',
  CONTACT_NAME_REQUIRED,
  {},
  { message: () => 'the buyer’s name is required' },
) {}

/** A phone that is not eight digits, with or without `+502`. */
export class PhoneNotGuatemalan extends Failure.invalid<PhoneNotGuatemalan>()(
  'PhoneNotGuatemalan',
  PHONE_NOT_GUATEMALAN,
  {},
  { message: () => 'the phone is a Guatemalan number of eight digits' },
) {}

/** An email address that cannot be one. */
export class EmailNotValid extends Failure.invalid<EmailNotValid>()(
  'EmailNotValid',
  EMAIL_NOT_VALID,
  {},
  { message: () => 'the email address is not valid' },
) {}

const COUNTRY_CODE = '502';
const NATIONAL_DIGITS = 8;
/** Separators a person types inside a number: spaces, dashes, dots, brackets. */
const SEPARATORS = /[\s\-.()]/g;
/** One `@`, something either side, a dot in the domain. Deliverability is the mail's to prove. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The eight national digits of a Guatemalan phone, or `undefined`. Accepts
 * `5555-1234`, `+502 5555 1234` and `50255551234`.
 */
const nationalDigits = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const compact = value.replace(SEPARATORS, '').replace(/^\+/, '');
  const digits =
    compact.length === COUNTRY_CODE.length + NATIONAL_DIGITS &&
    compact.startsWith(COUNTRY_CODE)
      ? compact.slice(COUNTRY_CODE.length)
      : compact;
  return new RegExp(`^\\d{${NATIONAL_DIGITS}}$`).test(digits)
    ? digits
    : undefined;
};

/**
 * The phone rule as an HTML `pattern` (anchored by the browser, compiled with
 * the `v` flag), so a form without script refuses what `normalizePhone`
 * refuses before anything is posted (#725). Any separators, an optional `+`
 * and `502`, then eight digits. The spec holds the two to the same answers.
 */
export const PHONE_INPUT_PATTERN =
  '[\\s\\-.\\(\\)]*\\+?(?:502)?(?:[\\s\\-.\\(\\)]*\\d){8}[\\s\\-.\\(\\)]*';

/**
 * A required text field as an HTML `pattern`: something other than spaces,
 * as `isFilled` asks of the name and the address.
 */
export const FILLED_INPUT_PATTERN = '.*\\S.*';

/** A phone as E.164 (`+50255551234`), or `undefined` when it is not one. */
export const normalizePhone = (value: unknown): string | undefined => {
  const digits = nationalDigits(value);
  return digits === undefined ? undefined : `+${COUNTRY_CODE}${digits}`;
};

const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};

/**
 * Every rule a contact breaks, each pointing at its field under `at`
 * (`/contact`, say). Empty when it is complete. The storefront's form and the
 * domain's `openGroup` both answer from this, so a buyer never meets a refusal
 * the form did not already give.
 */
export const contactProblems = (value: unknown, at = ''): FieldProblem[] => {
  const record = asRecord(value);
  const email = record['email'];
  return [
    ...(isFilled(record['name'])
      ? []
      : [problem(`${at}/name`, CONTACT_NAME_REQUIRED, 'the name is required')]),
    ...(normalizePhone(record['phone']) === undefined
      ? [
          problem(
            `${at}/phone`,
            PHONE_NOT_GUATEMALAN,
            'the phone is a Guatemalan number of eight digits',
          ),
        ]
      : []),
    ...(typeof email === 'string' && EMAIL.test(email.trim())
      ? []
      : [problem(`${at}/email`, EMAIL_NOT_VALID, 'the email is not valid')]),
    ...destinationProblems(record['destination'], `${at}/destination`),
  ];
};

/**
 * A contact checked and normalized — the phone as E.164, the email
 * lower-cased, text trimmed — or `Invalid` listing every field it got wrong.
 */
export const decodeBuyerContact = (
  value: unknown,
  at = '/contact',
): Effect.Effect<BuyerContactValue, Invalid> => {
  const problems = contactProblems(value, at);
  if (problems.length > 0)
    return Effect.fail(new Invalid({ errors: problems }));
  const record = asRecord(value);
  return Effect.succeed({
    name: String(record['name']).trim(),
    phone: normalizePhone(record['phone']) as string,
    email: String(record['email']).trim().toLowerCase(),
    destination: normalizeDestination(record['destination']),
  });
};

/** Every code a contact can be refused with, for a form that renders them. */
export const CONTACT_ERROR_CODES = [
  CONTACT_NAME_REQUIRED,
  PHONE_NOT_GUATEMALAN,
  EMAIL_NOT_VALID,
  DEPARTAMENTO_UNKNOWN,
  MUNICIPIO_OUTSIDE_DEPARTAMENTO,
  ZONA_OUT_OF_RANGE,
  ADDRESS_LINE_REQUIRED,
] as const;
