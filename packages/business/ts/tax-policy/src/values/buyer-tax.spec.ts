import { describe, expect, it } from 'vitest';

import {
  buyerTaxOf,
  isValidCui,
  isValidNit,
  nitCheckCharacter,
  normalizeTaxId,
} from './buyer-tax.js';
import {
  BuyerTaxIdInvalid,
  BuyerTaxIdTypeUnknown,
  BuyerTaxNameRequired,
} from './buyer-tax-failures.js';

describe('NIT and CUI', () => {
  it('computes the check character, K for ten', () => {
    expect(nitCheckCharacter('1234567')).toBe('9');
    expect(nitCheckCharacter('6')).toBe('K');
  });

  it('accepts a NIT however it is typed, and refuses a wrong check', () => {
    expect(normalizeTaxId(' 1234567-9 ')).toBe('12345679');
    expect(isValidNit('1234567-9')).toBe(true);
    expect(isValidNit('6-k')).toBe(true);
    expect(isValidNit('1234567-4')).toBe(false);
    expect(isValidNit('ABC')).toBe(false);
    expect(isValidNit('')).toBe(false);
  });

  it('accepts a CUI of thirteen digits only', () => {
    expect(isValidCui('2345 67890 0101')).toBe(true);
    expect(isValidCui('123')).toBe(false);
  });
});

describe('buyerTaxOf', () => {
  it('is a consumidor final under the contact name when nothing is given', () => {
    expect(buyerTaxOf({}, ' Ana López ')).toEqual({
      ok: true,
      value: { idType: 'cf', taxId: 'CF', name: 'Ana López' },
    });
    expect(buyerTaxOf({ idType: 'cf', name: 'Tienda' }, 'Ana')).toEqual({
      ok: true,
      value: { idType: 'cf', taxId: 'CF', name: 'Tienda' },
    });
    expect(buyerTaxOf({ idType: 'cf' })).toEqual({
      ok: true,
      value: { idType: 'cf', taxId: 'CF', name: '' },
    });
  });

  it('normalizes a valid NIT or CUI with its name', () => {
    expect(
      buyerTaxOf({ idType: 'nit', taxId: '1234567-9', name: ' Ferre SA ' }),
    ).toEqual({
      ok: true,
      value: { idType: 'nit', taxId: '12345679', name: 'Ferre SA' },
    });
    expect(
      buyerTaxOf({ idType: 'cui', taxId: '2345678900101', name: 'Ana' }),
    ).toMatchObject({ ok: true, value: { idType: 'cui' } });
  });

  it('refuses an unknown type, a bad id or a missing name', () => {
    expect(buyerTaxOf({ idType: 'dpi' })).toEqual({
      ok: false,
      problem: 'invalidTaxIdType',
    });
    expect(
      buyerTaxOf({ idType: 'nit', taxId: '1234567-4', name: 'A' }),
    ).toEqual({ ok: false, problem: 'invalidTaxId' });
    expect(buyerTaxOf({ idType: 'cui', taxId: 7, name: 'A' })).toEqual({
      ok: false,
      problem: 'invalidTaxId',
    });
    expect(buyerTaxOf({ idType: 'nit', taxId: '6-K', name: 3 })).toEqual({
      ok: false,
      problem: 'missingName',
    });
  });
});

describe('the buyer-tax failures', () => {
  it('carry the codes the form and the coordinator answer with', () => {
    const failures = [
      new BuyerTaxIdTypeUnknown(),
      new BuyerTaxIdInvalid({ idType: 'nit' }),
      new BuyerTaxNameRequired(),
    ];
    expect(failures.map(failure => failure.code)).toEqual([
      'invalidTaxIdType',
      'invalidTaxId',
      'missingName',
    ]);
    expect(failures.every(failure => failure.message !== '')).toBe(true);
  });
});
