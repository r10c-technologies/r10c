import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    type: 'master',
    items: [
      { label: 'Products', href: '/catalog/product', icon: <span>▦</span> },
      { label: 'Brands', href: '/catalog/product-brand' },
      {
        label: 'Categories',
        href: '/catalog/product-category',
        workspace: 'master:product-category',
      },
    ],
  },
  { items: [{ label: 'Account', href: '/account' }] },
];

/**
 * The destination itself, as opposed to the two "open where" affordances.
 *
 * A plain string name is a full match, which is the whole point here: both
 * affordances carry the item's label *inside* a longer accessible name, so a
 * regex would match three links for one row.
 */
const destination = (nav: HTMLElement, label: string) =>
  within(nav).getByRole('link', { name: label });

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
    const nav = screen.getByRole('navigation', { name: 'Principal' });

    expect(within(nav).getByText('Catalog')).toBeInTheDocument();
    expect(destination(nav, 'Products')).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(destination(nav, 'Brands')).not.toHaveAttribute('aria-current');
    // Second (untyped, untitled) section still renders its item.
    expect(destination(nav, 'Account')).toBeInTheDocument();
  });

  it('renders the screen type above the domain', () => {
    // ADR 0033's tier. The label is `shell:` copy owned by
    // `SCREEN_TYPE_LABEL_KEYS`, so it resolves here rather than in the host.
    render(<SidebarNav sections={sections} />);
    const nav = screen.getByRole('navigation', { name: 'Principal' });

    expect(
      within(nav).getByRole('group', { name: 'Definiciones' }),
    ).toBeInTheDocument();
    expect(within(nav).getByText('Definiciones')).toBeInTheDocument();
  });

  it('gives an untyped section no tier heading', () => {
    // The account surface is not a screen group at all (ADR 0033), so it gets
    // no heading rather than an invented one.
    render(<SidebarNav sections={[sections[1] as NavSection]} />);
    const nav = screen.getByRole('navigation', { name: 'Principal' });

    expect(within(nav).queryByRole('group')).toBeNull();
    expect(destination(nav, 'Account')).toBeInTheDocument();
  });

  it('hides labels and titles but keeps icons and adds a title tooltip when collapsed', () => {
    render(<SidebarNav sections={sections} collapsed />);
    const nav = screen.getByRole('navigation', { name: 'Principal' });

    expect(within(nav).queryByText('Catalog')).toBeNull();
    expect(within(nav).queryByText('Products')).toBeNull();
    expect(within(nav).queryByText('Definiciones')).toBeNull();
    // The icon-only link carries the label as a title for hover discovery.
    expect(within(nav).getByTitle('Products')).toBeInTheDocument();
  });

  it('keeps the tier as an accessible group while collapsed', () => {
    // Collapsing drops the headings, so without this the icon column reads as
    // one undifferentiated list — the state this tier was added to fix.
    render(<SidebarNav sections={sections} collapsed />);
    const nav = screen.getByRole('navigation', { name: 'Principal' });

    expect(
      within(nav).getByRole('group', { name: 'Definiciones' }),
    ).toBeInTheDocument();
  });

  it('offers both "open where" choices, without hover', () => {
    render(<SidebarNav sections={sections} />);
    const nav = screen.getByRole('navigation', { name: 'Principal' });

    expect(
      within(nav).getByRole('link', {
        name: 'Abrir Categories en el espacio de trabajo',
      }),
    ).toHaveAttribute('href', '/es/workspace?tab=master%3Aproduct-category');
    expect(
      within(nav).getByRole('link', { name: 'Abrir Categories en una pestaña nueva' }),
    ).toHaveAttribute('target', '_blank');
  });

  it('offers a new browser tab even for an item with no workspace address', () => {
    // Not every destination can be a workspace tab; every one can be a browser
    // tab, and middle-click was the only way to get one before.
    render(<SidebarNav sections={sections} />);
    const nav = screen.getByRole('navigation', { name: 'Principal' });

    expect(
      within(nav).queryByRole('link', {
        name: 'Abrir Products en el espacio de trabajo',
      }),
    ).toBeNull();
    expect(
      within(nav).getByRole('link', { name: 'Abrir Products en una pestaña nueva' }),
    ).toBeInTheDocument();
  });

  it('drops both affordances when collapsed, leaving the icon column', () => {
    render(<SidebarNav sections={sections} collapsed />);
    const nav = screen.getByRole('navigation', { name: 'Principal' });

    expect(
      within(nav).queryByRole('link', {
        name: 'Abrir Categories en el espacio de trabajo',
      }),
    ).toBeNull();
    expect(
      within(nav).queryByRole('link', {
        name: 'Abrir Categories en una pestaña nueva',
      }),
    ).toBeNull();
  });

  it('renders a plain heading when no group toggle is supplied', () => {
    render(<SidebarNav sections={sections} />);
    const nav = screen.getByRole('navigation', { name: 'Principal' });

    expect(within(nav).queryByRole('button')).toBeNull();
    expect(within(nav).getByText('Catalog')).toBeInTheDocument();
  });

  it('collapses a domain group and reports it as such', async () => {
    const onToggleGroup = vi.fn();
    const user = userEvent.setup();
    render(
      <SidebarNav
        sections={sections}
        collapsedGroups={{}}
        onToggleGroup={onToggleGroup}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Principal' });

    const toggle = within(nav).getByRole('button', { name: 'Plegar Catalog' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await user.click(toggle);
    expect(onToggleGroup).toHaveBeenCalledWith('Catalog');
  });

  it('hides a collapsed group’s items but keeps its heading reachable', () => {
    render(
      <SidebarNav
        sections={sections}
        collapsedGroups={{ Catalog: true }}
        onToggleGroup={vi.fn()}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Principal' });

    expect(
      within(nav).getByRole('button', { name: 'Desplegar Catalog' }),
    ).toHaveAttribute('aria-expanded', 'false');
    expect(
      within(nav).queryByRole('link', { name: 'Brands' }),
    ).toBeNull();
    // The untyped section is a different group and is unaffected.
    expect(destination(nav, 'Account')).toBeInTheDocument();
  });

  it('shows every item while the sidebar is collapsed, whatever the groups say', () => {
    // Group collapse is an expanded-mode affordance. Honouring it in the rail
    // would let a group vanish with no heading left to bring it back.
    render(
      <SidebarNav
        sections={sections}
        collapsed
        collapsedGroups={{ Catalog: true }}
        onToggleGroup={vi.fn()}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Principal' });

    expect(within(nav).getByTitle('Brands')).toBeInTheDocument();
  });

  it('tolerates a null pathname', () => {
    pathname = null;
    render(<SidebarNav sections={sections} />);
    const nav = screen.getByRole('navigation', { name: 'Principal' });
    expect(destination(nav, 'Products')).not.toHaveAttribute('aria-current');
  });
});
