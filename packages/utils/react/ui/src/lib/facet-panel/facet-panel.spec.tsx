import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { type FacetDefinition, FacetPanel } from './facet-panel.js';

const FACETS: readonly FacetDefinition[] = [
  {
    kind: 'checkbox',
    id: 'brand',
    label: 'Marca',
    options: [
      { label: 'Aurora', href: '/es/search?brand=a', selected: true, count: 3 },
      { label: 'Terra', href: '/es/search?brand=a&brand=t', selected: false },
    ],
  },
  {
    kind: 'toggle',
    id: 'available',
    label: 'Solo disponibles',
    href: '/es/search?brand=a&available=1',
    selected: false,
  },
  {
    kind: 'range',
    id: 'price',
    label: 'Precio',
    action: '/es/search',
    min: { name: 'min', label: 'Mínimo', value: '10' },
    max: { name: 'max', label: 'Máximo' },
    hidden: [
      ['brand', 'a'],
      ['q', 'lamp'],
    ],
    submitLabel: 'Aplicar',
  },
];

describe('FacetPanel', () => {
  it('is a landmark named by its label, one section per facet', () => {
    render(<FacetPanel label="Filtrar" facets={FACETS} />);

    const panel = screen.getByRole('complementary', { name: 'Filtrar' });
    for (const name of ['Marca', 'Solo disponibles', 'Precio']) {
      expect(within(panel).getByRole('region', { name })).toBeInTheDocument();
    }
  });

  it('renders each checkbox value as a link, the chosen ones current', () => {
    render(<FacetPanel label="Filtrar" facets={FACETS} />);

    const brand = screen.getByRole('region', { name: 'Marca' });
    const aurora = within(brand).getByRole('link', { name: /Aurora/ });
    expect(aurora).toHaveAttribute('href', '/es/search?brand=a');
    expect(aurora).toHaveAttribute('aria-current', 'true');
    expect(aurora).toHaveTextContent('3');
    expect(
      within(brand).getByRole('link', { name: 'Terra' }),
    ).not.toHaveAttribute('aria-current');
  });

  it('renders a toggle as one link', () => {
    render(<FacetPanel label="Filtrar" facets={FACETS} />);

    const toggle = screen.getByRole('region', { name: 'Solo disponibles' });
    expect(within(toggle).getByRole('link')).toHaveAttribute(
      'href',
      '/es/search?brand=a&available=1',
    );
  });

  it('marks a toggle that is on', () => {
    render(
      <FacetPanel
        label="Filtrar"
        facets={[{ ...FACETS[1], selected: true } as FacetDefinition]}
      />,
    );

    expect(screen.getByRole('link')).toHaveAttribute('aria-current', 'true');
  });

  it('renders a range as a GET form that keeps the rest of the search', () => {
    const { container } = render(
      <FacetPanel label="Filtrar" facets={FACETS} />,
    );

    const form = container.querySelector('form');
    expect(form).toHaveAttribute('method', 'get');
    expect(form).toHaveAttribute('action', '/es/search');
    expect(screen.getByLabelText('Mínimo')).toHaveValue(10);
    expect(screen.getByLabelText('Máximo')).toHaveValue(null);
    const hidden = [
      ...container.querySelectorAll<HTMLInputElement>('input[type=hidden]'),
    ].map(input => [input.name, input.value]);
    expect(hidden).toEqual([
      ['brand', 'a'],
      ['q', 'lamp'],
    ]);
    expect(screen.getByRole('button', { name: 'Aplicar' })).toHaveAttribute(
      'type',
      'submit',
    );
  });
});
