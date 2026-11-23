// r10c's languages, as the storefront loads them: `es` groups thousands as
// Guatemala does.
import '@r10c/business-ts-i18n/locales';

import { describe, expect, it } from 'vitest';

import { priceBasisLabel, quantityLabel, saleRuleLabel } from './price-basis';

/** A translator that shows which key it was asked for, with what. */
const t = (key: string, values?: Readonly<Record<string, string>>) =>
  values === undefined ? key : `${key}${JSON.stringify(values)}`;

describe('priceBasisLabel', () => {
  const label = priceBasisLabel(t, 'es');

  it('says nothing for a price for one piece', () => {
    expect(label({ saleUnit: 'UN', pricePer: 1 })).toBeUndefined();
  });

  it('names the unit alone for a price for one of it', () => {
    expect(label({ saleUnit: 'M', pricePer: 1 })).toBe(
      'storefront.price.per{"symbol":"entity:sale-unit.symbol.M"}',
    );
  });

  it('names how many for a price for a hundred or a thousand', () => {
    expect(label({ saleUnit: 'UN', pricePer: 1000 })).toBe(
      'storefront.price.perQuantity{"quantity":"1,000","symbol":"entity:sale-unit.symbol.UN"}',
    );
  });
});

describe('quantityLabel', () => {
  const label = quantityLabel(t, 'es');

  it('writes a quantity in its scale with its unit', () => {
    expect(label(3500, 'M')).toBe(
      'storefront.price.quantity{"quantity":"3.5","symbol":"entity:sale-unit.symbol.M"}',
    );
    expect(label(2, 'UN')).toBe(
      'storefront.price.quantity{"quantity":"2","symbol":"entity:sale-unit.symbol.UN"}',
    );
  });
});

describe('saleRuleLabel', () => {
  const label = saleRuleLabel(
    (key, values) => values?.['quantity'] ?? key,
    'es',
  );

  it('says nothing for an offering sold one whole unit at a time', () => {
    expect(
      label({ saleUnit: 'M', quantityStep: 1000, quantityMinimum: 1000 }),
    ).toBeUndefined();
  });

  it('states the minimum and the step of one that is not', () => {
    const words = saleRuleLabel(
      t,
      'es',
    )({
      saleUnit: 'M',
      quantityStep: 500,
      quantityMinimum: 1000,
    });
    expect(words).toContain('storefront.price.sold');
    expect(words).toContain('1');
    expect(words).toContain('0.5');
  });

  it('says it for a step alone, or a minimum alone', () => {
    expect(label({ saleUnit: 'UN', quantityStep: 1, quantityMinimum: 6 })).toBe(
      'storefront.price.sold',
    );
  });
});
