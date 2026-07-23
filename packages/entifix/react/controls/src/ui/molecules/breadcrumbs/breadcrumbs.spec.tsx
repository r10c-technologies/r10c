import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { type BreadcrumbItem, Breadcrumbs } from './breadcrumbs.js';

const trail: BreadcrumbItem[] = [
  { label: 'Home', href: '/' },
  { label: 'Catalog', href: '/catalog' },
  { label: 'Products' },
];

describe('Breadcrumbs', () => {
  it('renders anchors for linkable crumbs and marks the last as current', () => {
    render(<Breadcrumbs items={trail} />);

    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const home = within(nav).getByRole('link', { name: 'Home' });
    expect(home).toHaveAttribute('href', '/');
    expect(within(nav).getByRole('link', { name: 'Catalog' })).toHaveAttribute(
      'href',
      '/catalog',
    );
    // Last crumb is not a link and is the current page.
    expect(within(nav).queryByRole('link', { name: 'Products' })).toBeNull();
    expect(within(nav).getByText('Products')).toHaveAttribute(
      'aria-current',
      'page',
    );
    // Two separators between three crumbs.
    expect(within(nav).getAllByText('/')).toHaveLength(2);
  });

  it('uses the custom link renderer when provided', () => {
    render(
      <Breadcrumbs
        items={trail}
        renderLink={item => (
          <a data-testid="custom" href={item.href}>
            {item.label}
          </a>
        )}
      />,
    );
    expect(screen.getAllByTestId('custom')).toHaveLength(2);
  });

  it('renders a plain span for a non-last crumb without an href', () => {
    render(<Breadcrumbs items={[{ label: 'Root' }, { label: 'Leaf' }]} />);
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nav).queryByRole('link')).toBeNull();
    const root = within(nav).getByText('Root');
    expect(root.tagName).toBe('SPAN');
    expect(root).not.toHaveAttribute('aria-current');
  });

  it('accepts a custom separator, className and pass-through nav props', () => {
    render(
      <Breadcrumbs
        items={trail}
        separator="›"
        className="custom"
        id="crumbs"
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(nav).toHaveClass('custom');
    expect(nav).toHaveAttribute('id', 'crumbs');
    expect(within(nav).getAllByText('›')).toHaveLength(2);
  });
});
