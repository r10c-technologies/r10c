import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CategoryNav } from './category-nav.js';

describe('CategoryNav', () => {
  it('is a named list of links, the current one marked', () => {
    render(
      <CategoryNav
        label="Subcategorías"
        items={[
          { label: 'Lámparas de escritorio', href: '/es/c/desk-lamps' },
          { label: 'Techo', href: '/es/c/ceiling-lights', current: true },
        ]}
      />,
    );

    const nav = screen.getByRole('navigation', { name: 'Subcategorías' });
    expect(
      within(nav).getByRole('link', { name: 'Lámparas de escritorio' }),
    ).not.toHaveAttribute('aria-current');
    expect(within(nav).getByRole('link', { name: 'Techo' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('renders nothing for a leaf', () => {
    const { container } = render(
      <CategoryNav label="Subcategorías" items={[]} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
