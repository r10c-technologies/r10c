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

import type { SettlementAdapters } from './client-types.js';
import {
  SettlementProvider,
  useSettlementAdapters,
} from './settlement-context.js';

const repository = () =>
  Context.make(EntityRepositoryTag, makeInMemoryEntityRepository([]));

const adapters: SettlementAdapters = {
  agreementRest: repository(),
  commissionEntryRest: repository(),
  settlementRunRest: repository(),
  vendorPayoutRest: repository(),
  configurationStore: Context.make(
    ConfigurationRepositoryTag,
    makeStubConfigurationClient(),
  ),
};

const wrapperWith = (supplied?: SettlementAdapters) =>
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <SettlementProvider adapters={supplied}>{children}</SettlementProvider>
    );
  };

describe('the settlement adapters context', () => {
  it('publishes supplied adapters to its descendants', () => {
    const { result } = renderHook(() => useSettlementAdapters(), {
      wrapper: wrapperWith(adapters),
    });

    expect(result.current).toBe(adapters);
  });

  /**
   * The host mounts this and passes nothing: building the adapters here rather
   * than in the host keeps the composition root with the shell that knows which
   * backend answers. The `adapters` prop exists as the seam a test substitutes
   * at.
   */
  it('builds its own adapters when the host supplies none', () => {
    const { result } = renderHook(() => useSettlementAdapters(), {
      wrapper: wrapperWith(),
    });

    expect(
      Context.get(result.current.agreementRest, EntityRepositoryTag),
    ).toBeDefined();
    expect(
      Context.get(result.current.vendorPayoutRest, EntityRepositoryTag),
    ).toBeDefined();
    expect(
      Context.get(
        result.current.configurationStore,
        ConfigurationRepositoryTag,
      ),
    ).toBeDefined();
  });

  it('keeps one adapter set across re-renders', () => {
    // A fresh set per render would rebuild every REST adapter on every state
    // change, and each page merges these into an Effect context by identity.
    const { result, rerender } = renderHook(() => useSettlementAdapters(), {
      wrapper: wrapperWith(),
    });
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });

  // Without the provider every adapter would be `undefined` and the failure
  // would surface much later, inside a use-case, as something unrelated.
  it('fails loudly outside the provider', () => {
    expect(() => renderHook(() => useSettlementAdapters())).toThrow(
      /useSettlementAdapters must be used inside/,
    );
  });
});
