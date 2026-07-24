import 'fake-indexeddb/auto';

import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type EntityNav,
  EntityNavProvider,
  useEntityNav,
  useRouteEntityNav,
  useTabEntityNav,
} from './entity-nav.js';
import { useTabsStore } from './tabs-store.js';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

beforeEach(() => {
  push.mockClear();
  useTabsStore.setState({ tabs: [], activeParam: null });
});

describe('useRouteEntityNav', () => {
  it('pushes canonical list and entity URLs', () => {
    const { result } = renderHook(() => useRouteEntityNav());

    result.current.toList('product');
    result.current.toEntity('product', '123');

    expect(push).toHaveBeenNthCalledWith(1, '/catalog/product');
    expect(push).toHaveBeenNthCalledWith(2, '/catalog/product/123');
  });

  it('honours a custom base path', () => {
    const { result } = renderHook(() => useRouteEntityNav('/admin'));
    result.current.toList('brand');
    expect(push).toHaveBeenCalledWith('/admin/brand');
  });
});

describe('useTabEntityNav', () => {
  it('opens list and entity tabs', () => {
    const { result } = renderHook(() => useTabEntityNav());

    result.current.toList('product');
    expect(useTabsStore.getState().activeParam).toBe('catalog:product');

    result.current.toEntity('product', '123');
    expect(useTabsStore.getState().activeParam).toBe('entity:product:123');
  });
});

describe('useEntityNav', () => {
  it('falls back to route navigation with no provider', () => {
    const { result } = renderHook(() => useEntityNav());
    result.current.toList('product');
    expect(push).toHaveBeenCalledWith('/catalog/product');
  });

  it('uses the provided nav when a provider is mounted', () => {
    const nav: EntityNav = { toList: vi.fn(), toEntity: vi.fn() };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <EntityNavProvider value={nav}>{children}</EntityNavProvider>
    );

    const { result } = renderHook(() => useEntityNav(), { wrapper });
    result.current.toEntity('product', '9');

    expect(nav.toEntity).toHaveBeenCalledWith('product', '9');
    expect(push).not.toHaveBeenCalled();
  });
});
