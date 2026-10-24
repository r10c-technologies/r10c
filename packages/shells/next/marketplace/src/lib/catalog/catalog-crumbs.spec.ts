import { describe, expect, it } from 'vitest';

import { catalogCrumbs } from './catalog-crumbs';

const lighting = {
  code: 'lighting',
  name: 'Lighting',
  status: 'active' as const,
};
const desk = {
  code: 'desk-lamps',
  name: 'Desk Lamps',
  status: 'active' as const,
};

describe('catalogCrumbs', () => {
  it('runs home, then the category chain, each linked under the locale', () => {
    expect(
      catalogCrumbs({ locale: 'es', home: 'Inicio', trail: [lighting, desk] }),
    ).toEqual([
      { label: 'Inicio', href: '/es' },
      { label: 'Lighting', href: '/es/c/lighting' },
      { label: 'Desk Lamps', href: '/es/c/desk-lamps' },
    ]);
  });

  it('ends at the product when there is one', () => {
    expect(
      catalogCrumbs({
        locale: 'en',
        home: 'Home',
        trail: [lighting],
        leaf: 'Aurora Desk Lamp',
      }).at(-1),
    ).toEqual({ label: 'Aurora Desk Lamp' });
  });

  it('names a retired category without linking to its missing route', () => {
    const [, archive] = catalogCrumbs({
      locale: 'es',
      home: 'Inicio',
      trail: [{ code: 'archive', name: 'Archive', status: 'retired' as const }],
      leaf: 'Old Lamp',
    });

    expect(archive).toEqual({ label: 'Archive', href: undefined });
  });
});
