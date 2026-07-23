import { render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BackOfficeBreadcrumbs, buildCrumbs } from './breadcrumbs.js';

let pathname: string | null = '/catalog/product-brand';

vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  pathname = '/catalog/product-brand';
});

describe('buildCrumbs', () => {
  it('builds a trail, applies label overrides and humanizes the rest', () => {
    const crumbs = buildCrumbs(
      '/catalog/product-brand',
      { catalog: 'Catalog' },
      'Home',
    );
    expect(crumbs).toEqual([
      { label: 'Home', href: '/' },
      { label: 'Catalog', href: '/catalog' },
      { label: 'Product Brand', href: undefined },
    ]);
  });

  it('returns a single current crumb for the root path', () => {
    expect(buildCrumbs('/', {}, 'Dashboard')).toEqual([
      { label: 'Dashboard', href: undefined },
    ]);
  });
});

describe('BackOfficeBreadcrumbs', () => {
  it('renders the derived trail with client-side links', () => {
    render(<BackOfficeBreadcrumbs labels={{ catalog: 'Catalog' }} />);
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(within(nav).getByText('Product Brand')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('falls back to defaults for a null pathname', () => {
    pathname = null;
    render(<BackOfficeBreadcrumbs />);
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nav).getByText('Home')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});
