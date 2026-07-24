import { render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NavSection } from './nav.js';
import { isActive, SidebarNav } from './sidebar-nav.js';

let pathname: string | null = '/catalog/product';

vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const sections: NavSection[] = [
  {
    title: 'Catalog',
    items: [
      { label: 'Products', href: '/catalog/product', icon: <span>▦</span> },
      { label: 'Brands', href: '/catalog/product-brand' },
      {
        label: 'Categories',
        href: '/catalog/product-category',
        workspace: 'catalog:product-category',
      },
    ],
  },
  { items: [{ label: 'Account', href: '/account' }] },
];

beforeEach(() => {
  pathname = '/catalog/product';
});

describe('isActive', () => {
  it('matches an exact path and nested descendants, but not siblings', () => {
    expect(isActive('/catalog/product', '/catalog/product')).toBe(true);
    expect(isActive('/catalog/product/123', '/catalog/product')).toBe(true);
    expect(isActive('/catalog/product-brand', '/catalog/product')).toBe(false);
  });
});

describe('SidebarNav', () => {
  it('renders sections, marks the active item and shows an untitled group', () => {
    render(<SidebarNav sections={sections} />);
    const nav = screen.getByRole('navigation', { name: 'Primary' });

    expect(within(nav).getByText('Catalog')).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: /Products/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      within(nav).getByRole('link', { name: 'Brands' }),
    ).not.toHaveAttribute('aria-current');
    // Second (untitled) section still renders its item.
    expect(
      within(nav).getByRole('link', { name: 'Account' }),
    ).toBeInTheDocument();
  });

  it('hides labels and titles but keeps icons and adds a title tooltip when collapsed', () => {
    render(<SidebarNav sections={sections} collapsed />);
    const nav = screen.getByRole('navigation', { name: 'Primary' });

    expect(within(nav).queryByText('Catalog')).toBeNull();
    expect(within(nav).queryByText('Products')).toBeNull();
    // The icon-only link carries the label as a title for hover discovery.
    expect(within(nav).getByTitle('Products')).toBeInTheDocument();
  });

  it('offers "Open in workspace" for items that set a workspace param', () => {
    render(<SidebarNav sections={sections} />);
    const nav = screen.getByRole('navigation', { name: 'Primary' });

    const link = within(nav).getByRole('link', {
      name: 'Open Categories in workspace',
    });
    expect(link).toHaveAttribute(
      'href',
      '/workspace?tab=catalog%3Aproduct-category',
    );
    // Items without a workspace param get no such affordance.
    expect(
      within(nav).queryByRole('link', { name: 'Open Products in workspace' }),
    ).toBeNull();
  });

  it('hides the workspace affordance when collapsed', () => {
    render(<SidebarNav sections={sections} collapsed />);
    const nav = screen.getByRole('navigation', { name: 'Primary' });

    expect(
      within(nav).queryByRole('link', {
        name: 'Open Categories in workspace',
      }),
    ).toBeNull();
  });

  it('tolerates a null pathname', () => {
    pathname = null;
    render(<SidebarNav sections={sections} />);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(
      within(nav).getByRole('link', { name: /Products/ }),
    ).not.toHaveAttribute('aria-current');
  });
});
