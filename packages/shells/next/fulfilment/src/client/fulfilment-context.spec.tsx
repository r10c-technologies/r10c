import { EntityRepositoryTag } from '@entifix/business';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { renderHook } from '@testing-library/react';
import { Context } from 'effect';
import type { PropsWithChildren } from 'react';
import { describe, expect, it } from 'vitest';

import { createClientAdapters } from './adapters/create-client-adapters.js';
import type { FulfilmentAdapters } from './client-types.js';
import {
  FulfilmentProvider,
  useFulfilmentAdapters,
} from './fulfilment-context.js';

const real = createClientAdapters();

const adapters: FulfilmentAdapters = {
  shippingOrderRest: Context.make(
    EntityRepositoryTag,
    makeInMemoryEntityRepository([]),
  ),
  metadata: real.metadata,
  shippingOrderUseCases: real.shippingOrderUseCases,
};

const wrapperWith = (supplied?: FulfilmentAdapters) =>
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <FulfilmentProvider adapters={supplied}>{children}</FulfilmentProvider>
    );
  };

describe('the fulfilment adapters context', () => {
  it('publishes supplied adapters to its descendants', () => {
    const { result } = renderHook(() => useFulfilmentAdapters(), {
      wrapper: wrapperWith(adapters),
    });

    expect(result.current).toBe(adapters);
  });

  it('builds its own adapters when the host supplies none', () => {
    const { result } = renderHook(() => useFulfilmentAdapters(), {
      wrapper: wrapperWith(),
    });

    const repository = Context.get(
      result.current.shippingOrderRest,
      EntityRepositoryTag,
    );
    expect(repository.save).toBeTypeOf('function');
    expect(repository.delete).toBeTypeOf('function');
  });

  // A fresh set per render would rebuild every REST adapter on every state
  // change, and each page merges these into an Effect context by identity.
  it('keeps one adapter set across re-renders', () => {
    const { result, rerender } = renderHook(() => useFulfilmentAdapters(), {
      wrapper: wrapperWith(),
    });
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });

  it('fails loudly outside the provider', () => {
    expect(() => renderHook(() => useFulfilmentAdapters())).toThrow(
      /useFulfilmentAdapters must be used inside/,
    );
  });
});
