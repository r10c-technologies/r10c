import { describe, expect, it } from 'vitest';

import { groupByScreenType } from './group-by-screen-type';
import type { NavSection } from './nav';

const section = (title: string, type?: NavSection['type']): NavSection => ({
  title,
  type,
  items: [{ label: title, href: `/${title}` }],
});

describe('groupByScreenType', () => {
  it('puts every section of one type under a single tier', () => {
    const tiers = groupByScreenType([
      section('catalog', 'master'),
      section('system', 'master'),
    ]);

    expect(tiers).toHaveLength(1);
    expect(tiers[0]?.sections.map(s => s.title)).toEqual(['catalog', 'system']);
  });

  it('groups sections of one type even when they are not adjacent', () => {
    // A host concatenates fragments from several shells, so two `master`
    // sections can arrive with another type between them. Grouping by position
    // would render Definiciones twice.
    const tiers = groupByScreenType([
      section('catalog', 'master'),
      section('orders', 'operation'),
      section('system', 'master'),
    ]);

    expect(tiers.map(tier => tier.type)).toEqual(['master', 'operation']);
    expect(tiers[0]?.sections.map(s => s.title)).toEqual(['catalog', 'system']);
  });

  it('orders tiers by the taxonomy, not by arrival', () => {
    const tiers = groupByScreenType([
      section('reports', 'report'),
      section('catalog', 'master'),
      section('wizards', 'wizard'),
      section('orders', 'operation'),
    ]);

    expect(tiers.map(tier => tier.type)).toEqual([
      'master',
      'operation',
      'wizard',
      'report',
    ]);
  });

  it('sorts an untyped section below every typed one', () => {
    // The account surface. It is not a screen group, so it goes under the ones
    // that are — never interleaved with them.
    const tiers = groupByScreenType([
      section('account'),
      section('catalog', 'master'),
    ]);

    expect(tiers.map(tier => tier.type)).toEqual(['master', undefined]);
  });

  it('keeps the order sections were contributed in within a tier', () => {
    const tiers = groupByScreenType([
      section('b', 'master'),
      section('a', 'master'),
    ]);

    expect(tiers[0]?.sections.map(s => s.title)).toEqual(['b', 'a']);
  });

  it('has no tiers for no sections', () => {
    expect(groupByScreenType([])).toEqual([]);
  });
});
