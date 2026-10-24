import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SortControl } from './sort-control.js';

const OPTIONS = [
  { value: 'name', label: 'Nombre' },
  { value: 'price-asc', label: 'Precio' },
];

describe('SortControl', () => {
  it('is a navigation named by its label, one link per order', () => {
    render(
      <SortControl
        label="Ordenar por"
        options={OPTIONS}
        current="price-asc"
        hrefFor={value => `/es/search?sort=${value}`}
      />,
    );

    const nav = screen.getByRole('navigation', { name: 'Ordenar por' });
    expect(within(nav).getByRole('link', { name: 'Nombre' })).toHaveAttribute(
      'href',
      '/es/search?sort=name',
    );
    expect(
      within(nav).getByRole('link', { name: 'Nombre' }),
    ).not.toHaveAttribute('aria-current');
    expect(within(nav).getByRole('link', { name: 'Precio' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('marks nothing current when the default order applies', () => {
    render(
      <SortControl label="Ordenar por" options={OPTIONS} hrefFor={v => v} />,
    );

    for (const link of screen.getAllByRole('link')) {
      expect(link).not.toHaveAttribute('aria-current');
    }
  });
});
