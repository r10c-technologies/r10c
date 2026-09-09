import {
  ConfigurationRepositoryTag,
  EntityRepositoryTag,
} from '@r10c/entifix-ts-business';
import {
  makeInMemoryEntityRepository,
  makeStubConfigurationClient,
} from '@r10c/entifix-ts-testing-unit';
import { renderHook } from '@testing-library/react';
import { Context } from 'effect';
import type { PropsWithChildren } from 'react';
import { describe, expect, it } from 'vitest';

import type { StockAdapters } from './client-types.js';
import { StockProvider, useStockAdapters } from './stock-context.js';

const repository = () =>
  Context.make(EntityRepositoryTag, makeInMemoryEntityRepository([]));

const adapters: StockAdapters = {
  stockItemRest: repository(),
  stockMovementRest: repository(),
  reservationRest: repository(),
  configurationStore: Context.make(
    ConfigurationRepositoryTag,
    makeStubConfigurationClient(),
  ),
};

const wrapperWith = (supplied?: StockAdapters) =>
  function Wrapper({ children }: PropsWithChildren) {
    return <StockProvider adapters={supplied}>{children}</StockProvider>;
  };

describe('the stock adapters context', () => {
  it('publishes supplied adapters to its descendants', () => {
    const { result } = renderHook(() => useStockAdapters(), {
      wrapper: wrapperWith(adapters),
    });

    expect(result.current).toBe(adapters);
  });

  /**
   * The host mounts this and passes nothing: building the adapters here rather
   * than in the host keeps the composition root with the shell that knows which
   * backend answers, which is the arrangement `SystemManagementProvider`
   * already uses. The `adapters` prop exists as the seam a test substitutes at.
   */
  it('builds its own adapters when the host supplies none', () => {
    const { result } = renderHook(() => useStockAdapters(), {
      wrapper: wrapperWith(),
    });

    expect(Context.get(result.current.stockItemRest, EntityRepositoryTag)).toBeDefined();
    expect(
      Context.get(result.current.configurationStore, ConfigurationRepositoryTag),
    ).toBeDefined();
  });

  it('keeps one adapter set across re-renders', () => {
    // A fresh set per render would rebuild every REST adapter on every state
    // change, and each page merges these into an Effect context by identity.
    const { result, rerender } = renderHook(() => useStockAdapters(), {
      wrapper: wrapperWith(),
    });
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });

  // Without the provider every adapter would be `undefined` and the failure
  // would surface much later, inside a use-case, as something unrelated.
  it('fails loudly outside the provider', () => {
    expect(() => renderHook(() => useStockAdapters())).toThrow(
      /useStockAdapters must be used inside/,
    );
  });
});
