import { describe, expect, it } from 'vitest';

import { taxRuleOf, taxRulesFrom } from './tax-rule.js';

const SEEDED: Record<string, string> = {
  'iva.general.rate': '1200',
  'iva.general.basis': 'inclusive',
  'iva.small-taxpayer.rate': '500',
  'iva.small-taxpayer.basis': 'gross',
  'iva.simplified.rate': '1200',
  'iva.simplified.basis': 'inclusive',
};

const reading =
  (overrides: Record<string, string | undefined>) => (key: string) =>
    key in overrides ? overrides[key] : SEEDED[key];

describe('taxRulesFrom', () => {
  it('reads every regime from its two rows', () => {
    const read = taxRulesFrom(reading({}));
    expect(read).toEqual({
      ok: true,
      rules: {
        general: { rateBasisPoints: 1200, basis: 'inclusive' },
        'small-taxpayer': { rateBasisPoints: 500, basis: 'gross' },
        simplified: { rateBasisPoints: 1200, basis: 'inclusive' },
      },
    });
  });

  it('refuses a missing rate or basis rather than guessing one', () => {
    expect(taxRulesFrom(reading({ 'iva.simplified.rate': undefined }))).toEqual(
      {
        ok: false,
        problem: { kind: 'missing', key: 'iva.simplified.rate' },
      },
    );
    expect(taxRulesFrom(reading({ 'iva.general.basis': undefined }))).toEqual({
      ok: false,
      problem: { kind: 'missing', key: 'iva.general.basis' },
    });
  });

  it.each(['', ' ', '12.5', '-1', '10001', 'twelve'])(
    'refuses the rate %j',
    value => {
      expect(taxRulesFrom(reading({ 'iva.general.rate': value }))).toEqual({
        ok: false,
        problem: { kind: 'invalid', key: 'iva.general.rate', value },
      });
    },
  );

  it('refuses an unknown basis', () => {
    expect(taxRulesFrom(reading({ 'iva.general.basis': 'exclusive' }))).toEqual(
      {
        ok: false,
        problem: {
          kind: 'invalid',
          key: 'iva.general.basis',
          value: 'exclusive',
        },
      },
    );
  });
});

describe('taxRuleOf', () => {
  it('finds a known regime and nothing for an unknown one', () => {
    const read = taxRulesFrom(reading({}));
    if (!read.ok) throw new Error('seeded rules must read');
    expect(taxRuleOf(read.rules, 'general')?.rateBasisPoints).toBe(1200);
    expect(taxRuleOf(read.rules, 'other')).toBeUndefined();
  });
});
