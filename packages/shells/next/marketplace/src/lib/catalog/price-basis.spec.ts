// r10c's languages, as the storefront loads them: `es` groups thousands as
// Guatemala does.
import '@r10c/business-ts-i18n/locales';

import { describe, expect, it } from 'vitest';

import { priceBasisLabel } from './price-basis';

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
