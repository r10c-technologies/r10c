import { describe, expect, it } from 'vitest';

import {
  contactErrors,
  contactFieldName,
  contactOf,
  contactValuesOf,
  namesNoContact,
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
