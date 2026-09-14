import type { CommandSource } from '@r10c/entifix-ts-core';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { NavSection } from '../back-office/nav.js';
import { useNavSource } from './use-nav-source.js';

vi.mock('next/navigation', () => ({ usePathname: () => '/es/home' }));

const sections: NavSection[] = [
  {
    title: 'Catálogo',
    type: 'master',
    items: [
      { label: 'Productos', href: '/catalog/product' },
      {
        label: 'Categorías',
        href: '/catalog/product-category',
        workspace: 'master:product-category',
      },
    ],
  },
  // The account surface: the one section with no screen type (ADR 0033).
  {
    items: [
      { label: 'Perfil', href: '/account' },
      { label: 'Bandeja', href: '/inbox', workspace: 'operation:inbox' },
    ],
  },
];

const options = (source: CommandSource) => source.groups[0].options;
const run = (term = '') =>
  renderHook(() => useNavSource(sections, term)).result.current;

describe('useNavSource', () => {
  it('offers every destination the filtered nav still holds', () => {
    const labels = options(run()).map(o => o.label);

    expect(labels).toContain('Productos');
    expect(labels).toContain('Perfil');
  });

  it('prefixes the locale on every href', () => {
    expect(options(run()).map(o => o.href)).toContain('/es/catalog/product');
  });

  it('hints the screen type, so the sidebar’s top tier survives flattening', () => {
    const products = options(run()).find(o => o.id === 'nav:/catalog/product');

    expect(products?.hint).toBe('Definiciones');
    expect(products?.sublabel).toBe('Catálogo');
  });

  it('hints nothing for an untyped section, so its title is not printed twice', () => {
    const profile = options(run()).find(o => o.id === 'nav:/account');

    expect(profile?.hint).toBeUndefined();
    expect(profile?.sublabel).toBeUndefined();
  });

  it('offers opening as a workspace tab as a second row, not a modifier', () => {
    const workspace = options(run()).find(
      o => o.id === 'nav:workspace:master:product-category',
    );

    expect(workspace?.href).toBe('/es/workspace?tab=master%3Aproduct-category');
    expect(workspace?.hint).toBe('Pestaña');
  });

  it('says nothing about a tab row in a section with no title either', () => {
    const workspace = options(run()).find(
      o => o.id === 'nav:workspace:operation:inbox',
    );

    expect(workspace?.sublabel).toBeUndefined();
    expect(workspace?.hint).toBe('Pestaña');
  });

  it('filters here rather than leaving it to the palette', () => {
    expect(options(run('prod')).map(o => o.label)).toEqual(['Productos']);
  });

  it('titles the group from the shell catalog', () => {
    expect(run().groups[0].label).toBe('Navegación');
  });
});
