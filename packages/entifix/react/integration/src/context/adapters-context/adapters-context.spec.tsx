import { EntifixBuildError } from '@r10c/entifix-ts-core';
import { renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { describe, expect, it } from 'vitest';

import {
  createAdaptersContext,
  useAdaptersContext,
} from './adapters-context.js';

interface Adapters {
  productRest: string;
}

describe('adapters context', () => {
  it('reads the adapters a provider published', () => {
    const AdaptersContext = createAdaptersContext<Adapters>();
    const value: Adapters = { productRest: 'rest' };
    const wrapper = ({ children }: PropsWithChildren) => (
      <AdaptersContext.Provider value={value}>{children}</AdaptersContext.Provider>
    );

    const { result } = renderHook(() => useAdaptersContext(AdaptersContext), {
      wrapper,
    });

    expect(result.current).toBe(value);
  });

  // The default context value is `{}`, so a component rendered outside its
  // provider would otherwise receive an object with every adapter `undefined`
  // and fail much later, somewhere unrelated.
  it('fails loudly when rendered outside a provider', () => {
    const AdaptersContext = createAdaptersContext<Adapters>();

    expect(() =>
      renderHook(() => useAdaptersContext(AdaptersContext)),
    ).toThrow(EntifixBuildError);
  });

  it('names the missing provider in the failure', () => {
    const AdaptersContext = createAdaptersContext<Adapters>();

    expect(() => renderHook(() => useAdaptersContext(AdaptersContext))).toThrow(
      /AdaptersProvider/,
    );
  });

  it('treats an explicitly empty value as missing too', () => {
    const AdaptersContext = createAdaptersContext<Adapters>();
    const wrapper = ({ children }: PropsWithChildren) => (
      <AdaptersContext.Provider value={{} as Adapters}>
        {children}
      </AdaptersContext.Provider>
    );

    expect(() =>
      renderHook(() => useAdaptersContext(AdaptersContext), { wrapper }),
    ).toThrow(EntifixBuildError);
  });
});
