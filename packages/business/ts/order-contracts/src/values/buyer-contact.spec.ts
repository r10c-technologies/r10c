import { Invalid } from '@entifix/core';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  BuyerContactSchema,
  CONTACT_NAME_REQUIRED,
  ContactNameRequired,
  contactProblems,
  decodeBuyerContact,
  EMAIL_NOT_VALID,
  EmailNotValid,
  FILLED_INPUT_PATTERN,
  normalizePhone,
  PHONE_INPUT_PATTERN,
  PHONE_NOT_GUATEMALAN,
  PhoneNotGuatemalan,
} from './buyer-contact.js';
import {
  ADDRESS_LINE_REQUIRED,
  AddressLineRequired,
  DEPARTAMENTO_UNKNOWN,
  DepartamentoUnknown,
  destinationProblems,
  MUNICIPIO_OUTSIDE_DEPARTAMENTO,
  MunicipioOutsideDepartamento,
  normalizeDestination,
  ZONA_OUT_OF_RANGE,
  ZonaOutOfRange,
} from './delivery-destination.js';
import {
  departamentoOf,
  GUATEMALA_DEPARTAMENTOS,
  municipioBelongsTo,
  municipioOf,
} from './guatemala-geography.js';

const destination = {
  departamento: '01',
  municipio: '0101',
  zona: 10,
  addressLine: '  5a avenida 12-34  ',
  reference: ' portón negro ',
};

const contact = {
  name: ' Ana López ',
  phone: '5555-1234',
  email: ' Ana@Correo.COM ',
  destination,
};

const codesAt = (problems: readonly { pointer: string; code: string }[]) =>
  problems.map(({ pointer, code }) => [pointer, code]);

describe('the geography', () => {
  it('holds the 22 departamentos and 340 municipios', () => {
    expect(GUATEMALA_DEPARTAMENTOS).toHaveLength(22);
    expect(
      GUATEMALA_DEPARTAMENTOS.flatMap(departamento => departamento.municipios),
    ).toHaveLength(340);
  });

  it('gives every municipio code a prefix that is its own departamento', () => {
    for (const departamento of GUATEMALA_DEPARTAMENTOS)
      for (const municipio of departamento.municipios) {
        expect(municipio.code).toMatch(/^\d{4}$/);
        expect(departamentoOf(municipio.code.slice(0, 2))).toBe(departamento);
      }
  });

  it('finds by code, and places a municipio in its departamento only', () => {
    expect(departamentoOf('01')?.name).toBe('Guatemala');
    expect(municipioOf('0108')?.name).toBe('Mixco');
    expect(departamentoOf('23')).toBeUndefined();
    expect(municipioOf('0199')).toBeUndefined();
    expect(municipioBelongsTo('0108', '01')).toBe(true);
    expect(municipioBelongsTo('0108', '02')).toBe(false);
    expect(municipioBelongsTo('0199', '01')).toBe(false);
  });
});

describe('a delivery destination', () => {
  it('has no problem when it is deliverable, with or without a zona', () => {
    expect(destinationProblems(destination)).toEqual([]);
    expect(
      destinationProblems({
        departamento: '01',
        municipio: '0101',
        addressLine: '5a avenida',
      }),
    ).toEqual([]);
  });

  it('refuses a municipio under the wrong departamento, at its field', () => {
    expect(
      codesAt(
        destinationProblems({ ...destination, departamento: '02' }, '/d'),
      ),
    ).toEqual([['/d/municipio', MUNICIPIO_OUTSIDE_DEPARTAMENTO]]);
  });

  it('refuses zona 26, a fractional zona and zona 0', () => {
    for (const zona of [26, 2.5, 0])
      expect(codesAt(destinationProblems({ ...destination, zona }))).toEqual([
        ['/zona', ZONA_OUT_OF_RANGE],
      ]);
  });

  it('lists every broken field of something that is not a destination', () => {
    expect(codesAt(destinationProblems(null))).toEqual([
      ['/departamento', DEPARTAMENTO_UNKNOWN],
      ['/municipio', MUNICIPIO_OUTSIDE_DEPARTAMENTO],
      ['/addressLine', ADDRESS_LINE_REQUIRED],
    ]);
  });

  it('has no postal code and no country', () => {
    const members = Object.keys(normalizeDestination(destination));
    expect(members).not.toContain('postalCode');
    expect(members).not.toContain('zip');
    expect(members).not.toContain('country');
  });

  it('is trimmed, and its empty optional members are absent', () => {
    expect(normalizeDestination(destination)).toEqual({
      departamento: '01',
      municipio: '0101',
      zona: 10,
      addressLine: '5a avenida 12-34',
      reference: 'portón negro',
    });
    expect(
      normalizeDestination({ ...destination, zona: undefined, reference: ' ' }),
    ).toEqual({
      departamento: '01',
      municipio: '0101',
      addressLine: '5a avenida 12-34',
    });
  });
});

describe('a buyer contact', () => {
  it('normalizes a Guatemalan phone to E.164, however it was typed', () => {
    for (const typed of [
      '5555-1234',
      '5555 1234',
      '+502 5555 1234',
      '50255551234',
      '(502) 5555.1234',
    ])
      expect(normalizePhone(typed)).toBe('+50255551234');
  });

  it('refuses a seven-digit phone, a foreign one and a non-string', () => {
    for (const phone of ['555-1234', '+1 555 555 1234', 55551234])
      expect(normalizePhone(phone)).toBeUndefined();
  });

  it('decodes to a normalized contact', async () => {
    await expect(
      Effect.runPromise(decodeBuyerContact(contact)),
    ).resolves.toEqual({
      name: 'Ana López',
      phone: '+50255551234',
      email: 'ana@correo.com',
      destination: normalizeDestination(destination),
    });
  });

  it('refuses with every field it got wrong, each at its pointer', async () => {
    const failure = await Effect.runPromise(
      Effect.flip(
        decodeBuyerContact({
          name: ' ',
          phone: '555-1234',
          email: 'ana@',
          destination: { ...destination, zona: 26 },
        }),
      ),
    );
    expect(failure).toBeInstanceOf(Invalid);
    expect(codesAt(failure.errors)).toEqual([
      ['/contact/name', CONTACT_NAME_REQUIRED],
      ['/contact/phone', PHONE_NOT_GUATEMALAN],
      ['/contact/email', EMAIL_NOT_VALID],
      ['/contact/destination/zona', ZONA_OUT_OF_RANGE],
    ]);
  });

  it('treats something that is not an object as empty', () => {
    expect(contactProblems('nope').map(({ code }) => code)).toContain(
      CONTACT_NAME_REQUIRED,
    );
  });

  it('decodes its wire shape structurally', () => {
    expect(Schema.decodeUnknownSync(BuyerContactSchema)(contact)).toMatchObject(
      { name: contact.name },
    );
  });

  it('registers every refusal under the code the catalog translates', () => {
    expect(
      [
        new ContactNameRequired(),
        new PhoneNotGuatemalan(),
        new EmailNotValid(),
        new DepartamentoUnknown(),
        new MunicipioOutsideDepartamento(),
        new ZonaOutOfRange(),
        new AddressLineRequired(),
      ].map(failure => [failure.code, failure.message]),
    ).toEqual([
      [CONTACT_NAME_REQUIRED, 'the buyer’s name is required'],
      [
        PHONE_NOT_GUATEMALAN,
        'the phone is a Guatemalan number of eight digits',
      ],
      [EMAIL_NOT_VALID, 'the email address is not valid'],
      [DEPARTAMENTO_UNKNOWN, 'the departamento is not an INE code'],
      [
        MUNICIPIO_OUTSIDE_DEPARTAMENTO,
        'the municipio is not one of the departamento’s',
      ],
      [ZONA_OUT_OF_RANGE, 'the zona is an integer from 1 to 25'],
      [ADDRESS_LINE_REQUIRED, 'the address line is required'],
    ]);
  });
});

describe('the input patterns', () => {
  // How a browser applies `pattern`: anchored, under the `v` flag.
  const browser = (pattern: string) => new RegExp(`^(?:${pattern})$`, 'v');

  it('refuses in the browser exactly the phones normalizePhone refuses', () => {
    const phone = browser(PHONE_INPUT_PATTERN);
    for (const typed of [
      '5555-1234',
      '55551234',
      '+502 5555 1234',
      '50255551234',
      '(502) 5555-1234',
      '50212345',
      ' 5555.1234 ',
      '12',
      '5555-123',
      '5025555123',
      '+1 555 555 1234',
      '5555-12345',
      'cinco',
      '',
    ]) {
      expect(phone.test(typed), typed).toBe(normalizePhone(typed) !== undefined);
    }
  });

  it('asks a required text field for something other than spaces', () => {
    const filled = browser(FILLED_INPUT_PATTERN);
    expect(filled.test('Ana')).toBe(true);
    expect(filled.test('   ')).toBe(false);
    expect(filled.test('')).toBe(false);
  });
});
