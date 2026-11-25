import { extractMetaAccessors } from '@entifix/core';
import { describe, expect, it } from 'vitest';

import { plainVariant } from './catalog-publication.js';
import { VariantValueEntry } from './variant-value.js';

describe('VariantValueEntry', () => {
  it('starts as a blank colour, and holds what it is given', () => {
    const entry = new VariantValueEntry();
    expect([entry.axis, entry.value]).toEqual(['color', '']);

    entry.axis = 'size';
    entry.value = '40';
    expect([entry.axis, entry.value]).toEqual(['size', '40']);
    expect([new VariantValueEntry('finish', 'mate').value]).toEqual(['mate']);
  });

  it('describes an axis from the closed list and a required value', () => {
    const members = extractMetaAccessors(VariantValueEntry);
    expect(members.map(member => member.name)).toEqual(['axis', 'value']);
    expect(members.every(member => member.required === true)).toBe(true);
  });
});

describe('plainVariant', () => {
  it('reads class rows into plain values, in the axis order', () => {
    expect(
      plainVariant([
        new VariantValueEntry('size', '40'),
        new VariantValueEntry('color', 'café'),
      ]),
    ).toEqual([
      { axis: 'color', value: 'café' },
      { axis: 'size', value: '40' },
    ]);
  });

  it('reads nothing well-formed as no variant', () => {
    expect(plainVariant(undefined)).toBeUndefined();
    expect(plainVariant([{ axis: 'flavour', value: 'x' }])).toBeUndefined();
  });
});
