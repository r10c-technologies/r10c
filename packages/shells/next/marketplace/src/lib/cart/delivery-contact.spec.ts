import { describe, expect, it } from 'vitest';

import {
  buyerTaxOfValues,
  contactErrors,
  contactFieldName,
  contactOf,
  contactValuesOf,
  EMPTY_CHECKOUT_FORM,
  namesNoContact,
  refusalQuery,
  refusedState,
} from './delivery-contact';

const typed = {
  name: 'Ana López',
  phone: '5555-1234',
  email: 'ana@correo.com',
  municipio: '0108',
  zona: '4',
  addressLine: '5a avenida 12-34',
  reference: 'portón negro',
};

const formOf = (values: Record<string, string>) => {
  const form = new FormData();
  for (const [field, value] of Object.entries(values))
    form.set(contactFieldName(field as keyof typeof typed), value);
  form.set('locale', 'es');
  return form;
};

describe('the review form’s contact', () => {
  it('reads only its own fields off the form', () => {
    expect(contactValuesOf(formOf(typed))).toEqual(typed);
    expect(namesNoContact(contactValuesOf(new FormData()))).toBe(true);
    expect(namesNoContact(contactValuesOf(formOf({ name: '' })))).toBe(false);
  });

  it('nests it as the checkout states it, the departamento from the municipio', () => {
    expect(contactOf(typed)).toEqual({
      name: 'Ana López',
      phone: '5555-1234',
      email: 'ana@correo.com',
      destination: {
        departamento: '01',
        municipio: '0108',
        zona: 4,
        addressLine: '5a avenida 12-34',
        reference: 'portón negro',
      },
    });
    expect(contactOf({ ...typed, zona: ' ', reference: '' })).toEqual({
      name: 'Ana López',
      phone: '5555-1234',
      email: 'ana@correo.com',
      destination: {
        departamento: '01',
        municipio: '0108',
        addressLine: '5a avenida 12-34',
      },
    });
  });

  it('answers nothing for a complete contact, and one code per broken field', () => {
    expect(contactErrors(typed)).toEqual({});
    expect(contactErrors({})).toEqual({
      name: 'contactNameRequired',
      phone: 'phoneNotGuatemalan',
      email: 'emailNotValid',
      // The departamento follows from the municipio, so its error lands there.
      municipio: 'departamentoUnknown',
      addressLine: 'addressLineRequired',
    });
    expect(contactErrors({ ...typed, zona: '26', phone: '555' })).toEqual({
      phone: 'phoneNotGuatemalan',
      zona: 'zonaOutOfRange',
    });
  });
});

describe('a refusal carried on the address (#725)', () => {
  const CODES = ['phoneNotGuatemalan', 'emailNotValid'];

  it('round-trips codes and sellers, and never a typed value', () => {
    const query = refusalQuery({
      values: { phone: '12', email: 'x' },
      errors: { phone: 'phoneNotGuatemalan', email: 'emailNotValid' },
      tenders: {},
      tendersMissing: ['vendor-a'],
    });
    expect(query).toBe(
      'phone.phoneNotGuatemalan,email.emailNotValid,tender.vendor-a',
    );
    expect(query).not.toContain('12');
    expect(refusedState(query, CODES, ['vendor-a'])).toEqual({
      ...EMPTY_CHECKOUT_FORM,
      errors: { phone: 'phoneNotGuatemalan', email: 'emailNotValid' },
      tendersMissing: ['vendor-a'],
    });
  });

  it('ignores a field, a code or a seller the review does not have', () => {
    expect(
      refusedState(
        'phone.made-up,city.emailNotValid,tender.vendor-z,email.emailNotValid,email.phoneNotGuatemalan,nodot',
        CODES,
        ['vendor-a'],
      ),
    ).toEqual({ ...EMPTY_CHECKOUT_FORM, errors: { email: 'emailNotValid' } });
  });

  it('starts empty with nothing on the address', () => {
    expect(refusedState(undefined, CODES, [])).toBe(EMPTY_CHECKOUT_FORM);
    expect(refusedState('', CODES, [])).toBe(EMPTY_CHECKOUT_FORM);
    expect(refusedState(['a'], CODES, [])).toBe(EMPTY_CHECKOUT_FORM);
  });
});

describe('the fiscal identity fields', () => {
  it('documents a buyer who chose nothing as consumidor final, by the receiver', () => {
    expect(buyerTaxOfValues({ name: 'Ana López' })).toEqual({
      ok: true,
      value: { idType: 'cf', taxId: 'CF', name: 'Ana López' },
    });
    expect(buyerTaxOfValues({ taxIdType: '' })).toMatchObject({ ok: true });
  });

  it('marks the field each problem belongs to', () => {
    expect(contactErrors({ ...typed, taxIdType: 'nit', taxId: '1' })).toEqual({
      taxId: 'invalidTaxId',
    });
    expect(
      contactErrors({ ...typed, taxIdType: 'nit', taxId: '1234567-9' }),
    ).toEqual({ taxName: 'missingName' });
    expect(contactErrors({ ...typed, taxIdType: 'dpi' })).toEqual({
      taxIdType: 'invalidTaxIdType',
    });
    expect(
      contactErrors({
        ...typed,
        taxIdType: 'nit',
        taxId: '1234567-9',
        taxName: 'Ferre SA',
      }),
    ).toEqual({});
  });
});
