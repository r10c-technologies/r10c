import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTabsState } from '../workspace/tabs-state.js';
import { useTabsSource } from './use-tabs-source.js';

vi.mock('next/navigation', () => ({ usePathname: () => '/es/workspace' }));

const run = (term = '') =>
  renderHook(() => useTabsSource(term)).result.current;

describe('useTabsSource', () => {
  beforeEach(() => {
    useTabsState.setState({ tabs: [], activeParam: null });
  });

  it('is empty where the workspace store has not been hydrated', () => {
    expect(run().groups[0].options).toEqual([]);
  });

  it('offers each open tab as a deep link rather than a store call', () => {
    useTabsState.setState({
      tabs: [{ param: 'master:product-brand', title: 'Marcas' }],
      activeParam: 'master:product-brand',
    });

    expect(run().groups[0].options).toEqual([
      {
        id: 'tab:master:product-brand',
        label: 'Marcas',
        href: '/es/workspace?tab=master%3Aproduct-brand',
      },
    ]);
  });

  it('filters here rather than leaving it to the palette', () => {
    useTabsState.setState({
      tabs: [
        { param: 'master:product-brand', title: 'Marcas' },
        { param: 'master:user-identity', title: 'Usuarios' },
      ],
      activeParam: null,
    });

    expect(run('usu').groups[0].options.map(o => o.label)).toEqual([
      'Usuarios',
    ]);
  });

  it('titles the group from the shell catalog', () => {
    expect(run().groups[0].label).toBe('Pestañas abiertas');
  });
});
