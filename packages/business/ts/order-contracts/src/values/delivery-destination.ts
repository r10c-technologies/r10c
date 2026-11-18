import { Failure, type FieldProblem, openStruct } from '@entifix/core';
import { Schema } from 'effect';

import { departamentoOf, municipioBelongsTo } from './guatemala-geography';

/**
 * Where a parcel goes, written the way a Guatemalan courier reads it
 * ([ADR 0076](../../../../../../docs/adr/0076-delivery-destination-buyer-contact-and-the-way-back.md) §2):
 * a departamento and a municipio by INE code, a zona where the city has them,
 * a free-text line and a landmark. **No postal code**, because none is used,
 * and **no country**: v1 delivers inside Guatemala.
 */
export interface DeliveryDestinationValue {
  /** Two-digit INE code. */
  readonly departamento: string;
  /** Four-digit INE code, inside {@link departamento}. */
  readonly municipio: string;
  /** 1–25, where the municipio is divided in zonas. */
  readonly zona?: number;
  /** Colonia, calle or avenida, número. */
  readonly addressLine: string;
  /** "Frente a…", "portón negro". */
  readonly reference?: string;
}

/** The shape on the wire; {@link destinationProblems} checks what it means. */
export const DeliveryDestinationSchema = openStruct({
  departamento: Schema.String,
  municipio: Schema.String,
  zona: Schema.optionalKey(Schema.Number),
  addressLine: Schema.String,
  reference: Schema.optionalKey(Schema.String),
});

export const DEPARTAMENTO_UNKNOWN = 'departamentoUnknown';
export const MUNICIPIO_OUTSIDE_DEPARTAMENTO = 'municipioOutsideDepartamento';
export const ZONA_OUT_OF_RANGE = 'zonaOutOfRange';
export const ADDRESS_LINE_REQUIRED = 'addressLineRequired';

/** A departamento code that is not one of the 22. */
export class DepartamentoUnknown extends Failure.invalid<DepartamentoUnknown>()(
  'DepartamentoUnknown',
  DEPARTAMENTO_UNKNOWN,
  {},
  { message: () => 'the departamento is not an INE code' },
) {}

/** A municipio that does not exist, or lies in another departamento. */
export class MunicipioOutsideDepartamento extends Failure.invalid<MunicipioOutsideDepartamento>()(
  'MunicipioOutsideDepartamento',
  MUNICIPIO_OUTSIDE_DEPARTAMENTO,
  {},
  { message: () => 'the municipio is not one of the departamento’s' },
) {}

/** A zona that is not an integer from 1 to 25. */
export class ZonaOutOfRange extends Failure.invalid<ZonaOutOfRange>()(
  'ZonaOutOfRange',
  ZONA_OUT_OF_RANGE,
  {},
  { message: () => 'the zona is an integer from 1 to 25' },
) {}

/** A destination with no address line. */
export class AddressLineRequired extends Failure.invalid<AddressLineRequired>()(
  'AddressLineRequired',
  ADDRESS_LINE_REQUIRED,
  {},
  { message: () => 'the address line is required' },
) {}

const ZONA_MIN = 1;
const ZONA_MAX = 25;

export const problem = (
  pointer: string,
  code: string,
  detail: string,
): FieldProblem => ({ pointer, code, detail });

export const isFilled = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};

/**
 * Every rule a destination breaks, each pointing at its field under `at`
 * (`/contact/destination`, say). Empty when it is deliverable.
 */
export const destinationProblems = (
  value: unknown,
  at = '',
): FieldProblem[] => {
  const record = asRecord(value);
  const problems: FieldProblem[] = [];
  const departamento = record['departamento'];
  const municipio = record['municipio'];
  const zona = record['zona'];
  const knownDepartamento =
    typeof departamento === 'string' &&
    departamentoOf(departamento) !== undefined;
  if (!knownDepartamento)
    problems.push(
      problem(
        `${at}/departamento`,
        DEPARTAMENTO_UNKNOWN,
        'the departamento is not an INE code',
      ),
    );
  if (
    typeof municipio !== 'string' ||
    !knownDepartamento ||
    !municipioBelongsTo(municipio, departamento)
  )
    problems.push(
      problem(
        `${at}/municipio`,
        MUNICIPIO_OUTSIDE_DEPARTAMENTO,
        'the municipio is not one of the departamento’s',
      ),
    );
  if (
    zona !== undefined &&
    !(
      Number.isInteger(zona) &&
      (zona as number) >= ZONA_MIN &&
      (zona as number) <= ZONA_MAX
    )
  )
    problems.push(
      problem(
        `${at}/zona`,
        ZONA_OUT_OF_RANGE,
        'the zona is an integer from 1 to 25',
      ),
    );
  if (!isFilled(record['addressLine']))
    problems.push(
      problem(
        `${at}/addressLine`,
        ADDRESS_LINE_REQUIRED,
        'the address line is required',
      ),
    );
  return problems;
};

/**
 * A destination already checked, trimmed and with its optional members
 * written absent rather than empty.
 */
export const normalizeDestination = (
  value: unknown,
): DeliveryDestinationValue => {
  const record = asRecord(value);
  const reference = record['reference'];
  const zona = record['zona'];
  return {
    departamento: String(record['departamento']),
    municipio: String(record['municipio']),
    ...(typeof zona === 'number' ? { zona } : {}),
    addressLine: String(record['addressLine']).trim(),
    ...(isFilled(reference) ? { reference: reference.trim() } : {}),
  };
};
