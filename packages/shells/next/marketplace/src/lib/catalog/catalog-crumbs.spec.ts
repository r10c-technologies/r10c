import { describe, expect, it } from 'vitest';

import { catalogCrumbs } from './catalog-crumbs';

const lighting = {
  code: 'lighting',
  name: { es: 'Iluminación', en: 'Lighting' },
  status: 'active' as const,
};
const desk = {
  code: 'desk-lamps',
  name: { es: 'Lámparas de escritorio', en: 'Desk Lamps' },
  status: 'active' as const,
};

describe('catalogCrumbs', () => {
  it('runs home, then the category chain, each linked under the locale', () => {
    expect(
      catalogCrumbs({ locale: 'es', home: 'Inicio', trail: [lighting, desk] }),
    ).toEqual([
      { label: 'Inicio', href: '/es' },
      { label: 'Iluminación', href: '/es/c/lighting' },
      { label: 'Lámparas de escritorio', href: '/es/c/desk-lamps' },
    ]);
  });

  /** #573: a crumb names its category in the page's locale. */
  it('names each category in the page’s locale', () => {
    expect(
      catalogCrumbs({ locale: 'en', home: 'Home', trail: [lighting, desk] })
        .slice(1)
        .map(crumb => crumb.label),
    ).toEqual(['Lighting', 'Desk Lamps']);
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
      trail: [
        {
          code: 'archive',
          name: { es: 'Archivo', en: 'Archive' },
          status: 'retired' as const,
        },
      ],
      leaf: 'Old Lamp',
    });

    expect(archive).toEqual({ label: 'Archivo', href: undefined });
  });
});
