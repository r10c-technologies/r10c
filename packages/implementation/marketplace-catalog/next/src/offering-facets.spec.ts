import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import type {
  CheckboxFacet,
  FacetDefinition,
  RangeFacet,
  ToggleFacet,
} from '@r10c/utils-react-ui';
import { describe, expect, it } from 'vitest';

import {
  facetKinds,
  OFFERING_FACET_MEMBERS,
  type OfferingFacetContext,
  offeringFacets,
} from './offering-facets.js';
import { parseSearch } from './search-query.js';

const labels: OfferingFacetContext['labels'] = {
  category: 'Categoría',
  brand: 'Marca',
  seller: 'Vendedor',
  price: 'Precio',
  available: 'Solo disponibles',
  min: 'Desde',
  max: 'Hasta',
  apply: 'Aplicar',
};

const facets = (
  query: Record<string, string | string[]>,
  choices: OfferingFacetContext['choices'] = {},
) =>
  offeringFacets({
    path: '/es/search',
    state: parseSearch(query),
    choices,
    labels,
  });

const byId = <T extends FacetDefinition>(
  list: readonly FacetDefinition[],
  id: string,
) => list.find(facet => facet.id === id) as T;

describe('facetKinds', () => {
  it('reads each kind from the type the entity declares', () => {
    expect(facetKinds(PublishedOffering, OFFERING_FACET_MEMBERS)).toEqual({
      category: 'checkbox',
      brand: 'checkbox',
      seller: 'checkbox',
      price: 'range',
      available: 'toggle',
    });
  });

  it('refuses a member that is not filterable', () => {
    expect(() =>
      facetKinds(PublishedOffering, { description: 'description' }),
    ).toThrow('description must be declared filterable');
  });

  it('refuses a filterable member whose type is no facet', () => {
    expect(() =>
      facetKinds(PublishedOffering, { newest: 'publishedAt' }),
    ).toThrow('PublishedOffering: publishedAt is a date, which is not a facet');
  });
});

describe('offeringFacets', () => {
  it('shows only the price and the toggle when it is handed no choices', () => {
    expect(facets({}).map(facet => facet.id)).toEqual(['price', 'available']);
  });

  it('keeps the panel order whatever order the choices come in', () => {
    const list = facets(
      {},
      {
        seller: [{ id: 'org-1', name: 'Casa Solano' }],
        brand: [{ id: 'b-1', name: 'Aurora' }],
        category: [{ id: 'c-1', name: 'Iluminación' }],
      },
    );

    expect(list.map(facet => facet.id)).toEqual([
      'category',
      'brand',
      'seller',
      'price',
      'available',
    ]);
  });

  it('adds a brand to the ones chosen, and takes a chosen one away, from page 1', () => {
    const brand = byId<CheckboxFacet>(
      facets(
        { q: 'lamp', brand: 'b-1', page: '3' },
        {
          brand: [
            { id: 'b-1', name: 'Aurora' },
            { id: 'b-2', name: 'Terra' },
          ],
        },
      ),
      'brand',
    );

    expect(brand).toEqual({
      kind: 'checkbox',
      id: 'brand',
      label: 'Marca',
      options: [
        { label: 'Aurora', href: '/es/search?q=lamp', selected: true },
        {
          label: 'Terra',
          href: '/es/search?q=lamp&brand=b-1&brand=b-2',
          selected: false,
        },
      ],
    });
  });

  it('swaps the category rather than adding a second one', () => {
    const category = byId<CheckboxFacet>(
      facets(
        { category: 'c-1' },
        {
          category: [
            { id: 'c-1', name: 'Iluminación' },
            { id: 'c-2', name: 'Cocina' },
          ],
        },
      ),
      'category',
    );

    expect(category.options.map(option => option.href)).toEqual([
      '/es/search',
      '/es/search?category=c-2',
    ]);
  });

  it('turns the availability toggle on and off', () => {
    const off = byId<ToggleFacet>(facets({ q: 'lamp' }), 'available');
    const on = byId<ToggleFacet>(
      facets({ q: 'lamp', available: '1' }),
      'available',
    );

    expect(off).toEqual({
      kind: 'toggle',
      id: 'available',
      label: 'Solo disponibles',
      selected: false,
      href: '/es/search?q=lamp&available=1',
    });
    expect(on.selected).toBe(true);
    expect(on.href).toBe('/es/search?q=lamp');
  });

  it('submits the price as a form that keeps the rest of the search', () => {
    const price = byId<RangeFacet>(
      facets({
        q: 'lamp',
        brand: ['b-1', 'b-2'],
        min: '100',
        max: '250',
        page: '2',
      }),
      'price',
    );

    expect(price).toEqual({
      kind: 'range',
      id: 'price',
      label: 'Precio',
      action: '/es/search',
      min: { name: 'min', label: 'Desde', value: '100' },
      max: { name: 'max', label: 'Hasta', value: '250' },
      // The bounds are the form's own fields, and a new range starts at page 1.
      hidden: [
        ['q', 'lamp'],
        ['brand', 'b-1'],
        ['brand', 'b-2'],
      ],
      submitLabel: 'Aplicar',
    });
  });
});

describe('offeringFacets with counts', () => {
  const choices: OfferingFacetContext['choices'] = {
    brand: [
      { id: 'brand-a', name: 'Aurora' },
      { id: 'brand-t', name: 'Terra' },
    ],
    seller: [{ id: 'v-1', name: 'Casa' }],
  };

  it('puts a count on every option of a counted facet, 0 where nothing holds it', () => {
    const panel = offeringFacets({
      path: '/es/search',
      state: parseSearch({}),
      choices,
      labels,
      counts: { brand: [{ value: 'brand-a', count: 4 }] },
    });

    expect(
      byId<CheckboxFacet>(panel, 'brand').options.map(option => option.count),
    ).toEqual([4, 0]);
    // A facet it was given no counts for shows no numbers at all.
    expect(byId<CheckboxFacet>(panel, 'seller').options[0]).not.toHaveProperty(
      'count',
    );
  });
});
